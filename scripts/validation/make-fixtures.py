"""Overnight validation helper: creates the manual-validation fixture tree.

Builds realistic test data (invoices as PDFs, receipts, weekly notes, downloads,
vendor folders, journal template) used by the manual validation protocol described
in scripts/validation/README.md. Idempotent, test-only, safe to re-run.

Usage:
    python3 scripts/validation/make-fixtures.py

Environment:
    APPRENTICE_FIXTURES_ROOT   fixture tree root (default: ~/Desktop/Apprentice-test-work)
"""
import os, datetime, textwrap, random
ROOT = os.path.expanduser(os.environ.get("APPRENTICE_FIXTURES_ROOT", "~/Desktop/Apprentice-test-work"))

def pdf(path, lines, title):
    """Hand-written single-page PDF with Helvetica text (renders in Preview)."""
    def esc(s): return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content = ["BT", "/F1 22 Tf", "60 740 Td", f"({esc(title)}) Tj", "/F1 13 Tf", "0 -34 Td"]
    for line in lines:
        content.append(f"({esc(line)}) Tj")
        content.append("0 -20 Td")
    content.append("ET")
    stream = "\n".join(content).encode("latin-1")
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offsets: out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(out)

def txt(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(textwrap.dedent(body).lstrip("\n"))

vendors = [("Northwind Hosting", 48.00, "hosting"), ("Acme Cloud Storage", 12.50, "storage"), ("Pixel Print Shop", 95.20, "printing"), ("Blue Bottle Coffee", 23.40, "coffee"), ("Metro Transit", 66.00, "transport"), ("Lumen Electric", 141.75, "electricity")]
# S2: receipts inbox + vendor folders
for i, (v, amt, kind) in enumerate(vendors, 1):
    pdf(f"{ROOT}/Receipts-Inbox/receipt-{2026090 + i}.pdf", [f"Vendor: {v}", f"Date: 2026-08-{10+i:02d}", f"Category: {kind}", "", f"Total: USD {amt:.2f}", "", "Paid by card ending 4421."], f"Receipt {2026090 + i}")
    os.makedirs(f"{ROOT}/Vendors/{v}", exist_ok=True)
# S1: invoices to file
for i, (v, amt, kind) in enumerate(vendors[:3], 1):
    pdf(f"{ROOT}/Invoices/invoice-INV-11{i:02d}.pdf", [f"Merchant: {v}", f"Date: 2026-08-2{i}", "", f"Service {kind}    USD {amt:.2f}", f"Total            USD {amt:.2f}", "", "Thank you for your business."], f"Invoice INV-11{i:02d}")
txt(f"{ROOT}/Invoices/ledger.txt", """
    # Ledger (date | vendor | amount | file)
    2026-08-19 | Lumen Electric | 141.75 | invoice-INV-1090.pdf
    """)
# S3: meeting transcripts
txt(f"{ROOT}/Transcripts/standup-2026-09-03.txt", """
    Standup 2026-09-03 (9:05-9:19)
    Dana: finished the export bug, starting on the retention job today.
    Omer: onboarding copy review is done; waiting on legal for the privacy text.
    Maya: two customer calls yesterday, both asked for CSV import. Blocked on API keys for staging.
    Decisions: ship the retention job Friday; CSV import goes on the roadmap for October.
    Action items: Dana - retention job PR by Thursday. Omer - chase legal. Maya - write the CSV import brief.
    """)
txt(f"{ROOT}/Transcripts/standup-2026-09-04.txt", """
    Standup 2026-09-04 (9:02-9:16)
    Dana: retention job PR is up, needs review.
    Omer: legal approved the privacy text; publishing today.
    Maya: CSV import brief drafted; staging keys arrived.
    Decisions: review the retention PR today; publish onboarding copy.
    Action items: Omer - publish copy. Dana - address review. Maya - share the brief in #product.
    """)
# S4: badly named downloads
for name, body in [("Screenshot 2026-09-01 at 10.41.03.txt", "quarterly numbers, draft"), ("document (3).txt", "vendor agreement, signed copy"), ("untitled 7.txt", "notes from the Lumen call"), ("export-final-FINAL2.txt", "customer list export")]:
    txt(f"{ROOT}/Downloads-Sim/{name}", body + "\n")
# S5: weekly roll-up
for day, total in [("monday", 1240.50), ("tuesday", 980.00), ("wednesday", 1512.25)]:
    txt(f"{ROOT}/Weekly/{day}.txt", f"""
    Daily sales report - {day.title()} 2026-09-01 week
    Orders: {random.Random(day).randint(20, 60)}
    Refunds: 2
    Total: {total:.2f}
    """)
txt(f"{ROOT}/Weekly/summary.txt", "# Weekly summary (day | total)\n")
# S6: journal template
txt(f"{ROOT}/Journal/template.txt", """
    ## Focus
    -
    ## Meetings
    -
    ## Wins
    -
    ## Tomorrow
    -
    """)
print("fixtures ready under", ROOT)
for root, dirs, files in os.walk(ROOT):
    print(root.replace(ROOT, "."), sorted(files))
