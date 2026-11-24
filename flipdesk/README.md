# FlipDesk

A static website for running a PC / phone / electronics flipping business. No build step, no backend, no dependencies. All data stays in your browser (localStorage).

## Run it

Open `flipdesk/index.html` directly in a browser, or serve the folder:

```bash
cd flipdesk && python3 -m http.server 8080
```

Then go to http://localhost:8080.

## Pages

| Page | What it does |
|---|---|
| `index.html` Dashboard | KPIs (net profit, cash vs reserve, margin, ROI, days to sell, turnover, defect rate), cumulative profit chart, profit by category, warnings, settings |
| `prompt.html` Prompt Builder | Builds a detailed prompt to paste into Claude. 8 modes: deal hunt, evaluate a listing, price my item, part-out vs whole, build to flip, market research, negotiation, business review. Includes your settings, business snapshot and inventory, plus search links for FB Marketplace, Gumtree, eBay sold, CeX, StaticICE, PCPartPicker, OzBargain. Save and reload prompts. |
| `inventory.html` | Ledger of items (buy → test → list → sold) and operating expenses. JSON backup/restore, CSV export. |
| `calculators.html` | Max buy price, markup/margin/annualised ROI, expected value comparison, part-out vs whole, stale stock (sunk cost), compound growth |
| `checklists.html` | Interactive SOPs: before you buy, GPU, desktop PC, phone, laptop, console |
| `listing.html` | Generates a Marketplace title and description, with pricing-buffer advice and a photo checklist |
| `learn.html` | Condensed business fundamentals and a 10-question quiz |

## Notes

- The Prompt Builder has three access modes. **Browser** (default): for Claude Desktop's built-in browser or Claude in Chrome while you are logged in to Facebook. Claude skims a set number of listings, opens the best ones, and stays read-only (no messages, offers or account changes). It stops at any captcha or rate-limit warning. **Web search only**: no logins, so Facebook usually isn't readable and Claude gives you searches to run. **Paste**: you supply the listings. In every mode Claude is told to value items on sold prices and never invent listings.
- Export a backup from Inventory → Backup & data regularly. Clearing your browser data deletes everything.
- The legal/tax section is general information, not advice.
