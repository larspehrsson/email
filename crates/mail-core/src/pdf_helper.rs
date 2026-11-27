//! Reading PDFs for search in a separate, short-lived process.
//!
//! A PDF comes from whoever sent the mail, and the PDF library can be made to crash in ways
//! `catch_unwind` doesn't catch (a form that draws itself recurses until the stack overflows,
//! which aborts the process), to loop for good, or to use up memory. So the app doesn't read
//! one itself: it starts its own program again with [`FLAG`], hands it the PDF on stdin and
//! takes the text from stdout ([`read`]). A helper that crashes, takes longer than
//! [`TIME_LIMIT`] (then it's killed) or fails gives no text: that PDF isn't searchable, and the
//! message is indexed without it (so it isn't tried again at the next start).

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The flag the app's program is started with to be the helper (as `--mcp` makes it a relay).
pub const FLAG: &str = "--pdf-text";
/// How long a PDF may take (the slowest of 2,228 real ones took under 4 s).
pub const TIME_LIMIT: Duration = Duration::from_secs(20);
/// The most memory the helper may use, where the system enforces it (Linux).
#[cfg(target_os = "linux")]
const MEMORY_LIMIT: u64 = 1 << 30;
/// The text is framed, so nothing else the program might print is taken for it.
const START: &[u8] = b"\n<<pdf-text>>\n";
const END: &[u8] = b"\n<</pdf-text>>\n";
/// The most text taken from one PDF (search keeps less: `mime::ATTACHMENT_TEXT_MAX`).
const OUTPUT_MAX: usize = 1 << 20;

/// The helper's side: the PDF on stdin, its text on stdout. Returns the exit code.
pub fn serve() -> i32 {
    #[cfg(target_os = "linux")]
    {
        let limit = libc::rlimit { rlim_cur: MEMORY_LIMIT, rlim_max: MEMORY_LIMIT };
        // SAFETY: setrlimit with a valid struct; this process only reads one PDF.
        unsafe { libc::setrlimit(libc::RLIMIT_AS, &limit) };
    }
    let mut data = Vec::new();
    if std::io::stdin().read_to_end(&mut data).is_err() {
        return 1;
    }
    let Some(text) = crate::mime::pdf_text_here(&data) else { return 2 };
    let mut out = std::io::stdout().lock();
    let wrote = out.write_all(START).and_then(|_| out.write_all(text.as_bytes())).and_then(|_| out.write_all(END)).and_then(|_| out.flush());
    if wrote.is_ok() { 0 } else { 1 }
}

/// The app's side: the text of the PDF `data`, read by the helper (`program` with `args`; the
/// app passes its own program and [`FLAG`]). None when it gives none in `limit`.
pub fn read(program: &Path, args: &[&str], envs: &[(&str, &str)], data: &[u8], limit: Duration) -> Option<String> {
    let mut child = Command::new(program)
        .args(args)
        .envs(envs.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| tracing::warn!("reading a PDF for search: no helper: {e}"))
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let mut stdout = child.stdout.take()?;
    let data = data.to_vec();
    // Written and read on threads of their own, so a helper that stops reading (or writes a
    // lot) can't hold this one up past the time limit.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&data);
    });
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = (&mut stdout).take(OUTPUT_MAX as u64 + 64).read_to_end(&mut out);
        out
    });
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                tracing::info!("reading a PDF for search: no answer in time, given up");
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let _ = writer.join();
    let out = reader.join().ok()?;
    if !status?.success() {
        return None;
    }
    let start = find(&out, START)? + START.len();
    let end = start + find(&out[start..], END)?;
    Some(String::from_utf8_lossy(&out[start..end]).into_owned())
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This test program, as the helper: started again running only `helper_child`.
    fn read_here(data: &[u8], mode: &str, limit: Duration) -> Option<String> {
        let me = std::env::current_exe().unwrap();
        read(&me, &["pdf_helper::tests::helper_child", "--exact", "--nocapture", "--test-threads=1"], &[("MAIL_PDF_HELPER_TEST", mode)], data, limit)
    }

    /// Not a test of its own: the helper, when another test starts this program for it.
    #[test]
    fn helper_child() {
        match std::env::var("MAIL_PDF_HELPER_TEST").as_deref() {
            Ok("serve") => std::process::exit(serve()),
            Ok("hang") => {
                std::thread::sleep(Duration::from_secs(60));
                std::process::exit(0)
            }
            _ => {}
        }
    }

    /// A PDF whose form XObject draws itself: the library recurses until the stack overflows,
    /// which aborts the process reading it (Richard's test case).
    fn self_drawing_form() -> Vec<u8> {
        let content = "BT /F1 12 Tf 72 720 Td (hello) Tj ET /X1 Do";
        let form = "/X1 Do";
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /X1 6 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_string(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
            format!("<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /XObject << /X1 6 0 R >> >> /Length {} >>\nstream\n{form}\nendstream", form.len()),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        let xref = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
        for o in offsets {
            out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
        out
    }

    #[test]
    fn reads_a_pdf() {
        let text = read_here(&crate::mime::tests::tiny_pdf("Invoice for the wombat enclosure"), "serve", TIME_LIMIT).unwrap();
        assert!(text.contains("wombat enclosure"), "{text}");
        assert_eq!(read_here(b"%PDF-1.4 nothing else", "serve", TIME_LIMIT), None, "a broken one: none");
    }

    /// A PDF that crashes the library takes only the helper down: no text, and this goes on.
    #[test]
    fn a_crashing_pdf_takes_only_the_helper_down() {
        assert_eq!(read_here(&self_drawing_form(), "serve", TIME_LIMIT), None);
    }

    #[test]
    fn a_helper_that_takes_too_long_is_stopped() {
        let t = Instant::now();
        assert_eq!(read_here(b"%PDF-1.4", "hang", Duration::from_millis(500)), None);
        assert!(t.elapsed() < Duration::from_secs(10), "not waited for: {:?}", t.elapsed());
    }

    #[test]
    fn no_helper_no_text() {
        assert_eq!(read(Path::new("/nonexistent/helper"), &[], &[], b"%PDF-1.4", TIME_LIMIT), None);
    }
}
