# Calibration set: terms finding (T05)

Read on 2026-11-08 by Lane B. This is a plain reading for the team, not legal advice. Ask Vidyut, and counsel before any paid use.

## Awwwards
Page read: https://www.awwwards.com/terms/ (the "Legal Terms" page; https://www.awwwards.com/terms-of-use/ returns 404).

What it says, quoted:
- "All material contained on this website is the property of Awwwards. All rights are reserved and any unauthorized use or reproduction is strictly prohibited."
- "Our content may not be used for commercial purposes unless expressly authorized by Awwwards."
- "Websites featured on our site remain the intellectual property of their creators."

What we do because of it:
- We take only facts from Awwwards: which sites won Site of the Day, on what date, and the winner's own URL. Each manifest entry links its Awwwards page as `source`.
- We do not copy Awwwards material: no screenshots of awwwards.com, no jury scores, no descriptions, no images from their CDN.
- We screenshot the winners' own public home pages, once, at 1440 by 900 and 390 by 844, for internal judge calibration only. Those sites belong to their creators, so the screenshots stay on the machine that captured them, in `calibration/images/` (gitignored), and are never committed, published or shown to customers.
- Open question for Vidyut: calibrating a judge for a product we may sell could count as commercial use of the list itself. If the answer is no, we replace the Awwwards source with a list we assemble ourselves.

## Internet Archive (legacy entries 01 to 20)
Twenty legacy entries are US public school district home pages as archived around June 2005. We use the archive because live legacy school sites are now rare and many sit behind bot challenges. The Internet Archive's terms (https://archive.org/about/terms.php, not re-read this run) allow viewing for research and scholarship; the same local only rule applies to these screenshots.

## Live legacy sites (entries 21 to 25)
Five small organisation and school pages that are still live and still legacy (no mobile viewport tag, layout tables, font tags). One home page load each, robots.txt respected, user agent names the project. Screenshots stay local.

## Student data
Calibration screenshots are sent to the three judge models; that is the point of calibration. They are public home pages, not customer data. Before the live run, look through `calibration/images/` and replace any entry whose screenshot shows identifiable students, so the rule "no student photos to model providers" holds here too.
