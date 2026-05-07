npm run dashboard# Staff Database Portal

A Discord staff database that syncs with Melonly API and deploys to GitHub Pages for 24/7 availability without needing a running Codespace.

## Features

✅ **GitHub Pages Hosting** - Dashboard accessible 24/7 via GitHub Pages  
✅ **Discord Sync** - Automatically pulls staff data from Discord roles  
✅ **Melonly Integration** - Tracks shifts, LOAs, and activity  
✅ **Export Tools** - CSV/JSON export of staff data  
✅ **Zero Runtime Cost** - Runs on GitHub Actions, hosted on GitHub Pages  
✅ **Auto-Deploy** - Changes push automatically to the live dashboard  

## Setup

### 1. GitHub Secrets (Required)

Go to **Settings → Secrets and variables → Actions** and add:

```
DISCORD_TOKEN      - Your Discord bot token
GUILD_ID           - Your server ID (number)
MELONLY_TOKEN      - Your Melonly API token (optional)
```

### 2. GitHub Pages Configuration

1. Go to **Settings → Pages**
2. Set **Source** to `Deploy from a branch`
3. Set **Branch** to `main` and folder to `/docs`
4. Save

Your site will be live at: `https://username.github.io/staff-database/`

### 3. Run First Sync

Trigger the workflow manually:
1. Go to **Actions**
2. Click **Deploy to GitHub Pages**
3. Click **Run workflow**

Or push changes to trigger automatically.

## File Structure

```
staff-database/
├── .github/workflows/deploy.yml      # Auto-deploy workflow
├── docs/index.html                    # GitHub Pages dashboard (static)
├── staff-db/
│   ├── bot/
│   │   ├── api.js                     # Express API (local dev)
│   │   └── bot.js                     # Discord sync script
│   ├── staff.json                     # Data file (synced)
│   ├── frontend/index.html            # Full-featured dashboard (local)
│   └── package.json
└── README.md
```

## How It Works

### Dashboard (GitHub Pages)

The light dashboard (`/docs/index.html`) runs entirely in the browser:
- Loads `docs/staff-data.json` from the published site
- Falls back to raw GitHub content if needed
- Auto-updates when `staff-db/staff.json` changes on `main`
- No server needed - purely static files

**URL:** `https://leodiscorduse-cell.github.io/staff-database/`

### Local API Server

For full features locally, run:

```bash
cd staff-db
npm install
npm run dashboard       # Starts API on http://localhost:3001
npm run sync          # Manual Discord sync
npm start             # Both bot and API
```

## Melonly Integration

The bot tries multiple approaches to find your staff in Melonly:
- `/server/members/discord/{discordId}` (standard)
- `/server/members?discordId={discordId}` (fallback)
- Searches by `memberId`, `userId`, `staffId` fields

**If no matches:**
- Verify Discord IDs are linked in Melonly
- Check your MELONLY_TOKEN is valid
- Verify GUILD_ID matches your Melonly server

The sync logs show exactly how many staff were matched.

## Troubleshooting

### "Matched 0 staff to Melonly"

1. Check your MELONLY_TOKEN in GitHub Secrets
2. Verify the token isn't expired
3. Check that Discord IDs exist in Melonly via their dashboard
4. Look at the workflow logs for detailed API responses

### GitHub Pages not updating

1. Check **Actions** tab for workflow errors
2. Verify **Settings → Pages** is set to `/docs` branch
3. Try running workflow manually

### Data not syncing

1. Ensure DISCORD_TOKEN and GUILD_ID are set in Secrets
2. Check **Actions** log output
3. Verify bot has permission to read member list

## API Endpoints (Local Only)

When running locally:

```
GET  /api/staff              # All staff with filtering
GET  /api/staff/:userId      # Single staff member
GET  /api/stats              # Stats summary
GET  /api/logs               # Sync history
GET  /api/export?format=csv  # Export CSV
GET  /api/export?format=json # Export JSON
PATCH /api/staff/:userId/notes # Update notes
```

## Deployment Tips

- **Automated syncs:** Set up a GitHub Actions schedule to sync daily
- **Custom domain:** Add CNAME file pointing to your domain
- **Private repo:** Still works - GitHub Pages auth handled automatically
- **Webhooks:** Bot can listen for Discord changes and auto-sync

## License

Private/Internal Use
