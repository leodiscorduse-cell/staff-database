const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,

  // Staff roles in order from highest to lowest
  staffRoles: [
    // Chairman
    'Chairman',
    // Directive
    'Director',
    'Deputy Director',
    // Management
    'Manager',
    'Senior Manager',
    // Admin
    'Administrator',
    'Senior Administrator',
    // Mod
    'Senior Moderator',
    'Moderator',
    'Trial Moderator',
    // Other
    'Helper',
    'Staff',
  ],

  // Role hierarchy groups (for sorting/display)
  roleGroups: {
    'Chairman Team':          ['Chairman'],
    'Directive Management':   ['Director', 'Deputy Director'],
    'Admin Team':             ['Administrator', 'Senior Administrator', 'Manager', 'Senior Manager'],
    'Mod Team':               ['Senior Moderator', 'Moderator', 'Trial Moderator'],
    'Staff':                  ['Helper', 'Staff'],
  },

  // Strike roles
  strikeRoles: [
    'Strike 1',
    'Strike 2 (Demotion)',
    'Strike 3 (Termination)',
  ],

  // Permission roles
  permRoles: [
    '50 / 50 Shift Permission',
    'Off Duty Command Permission',
    'Session Host Permission',
    'Promotion Permission',
    'Infraction Permission',
  ],

  // Sub team roles
  subTeamRoles: [
    'Media Team',
    'Event Team',
    'Social Media Team',
    'Education & Training Team',
  ],

  // LOA and ZTP
  loaRole: 'LOA',
  ztpRole: 'ZTP',
};
// ──────────────────────────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, '..', 'staff.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ staff: {}, sync_log: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

async function syncStaff() {
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) {
    console.error(`[ERROR] Guild ${CONFIG.guildId} not found. Check your GUILD_ID secret.`);
    return;
  }

  console.log(`[SYNC] Starting staff sync for "${guild.name}"...`);
  await guild.members.fetch();

  const now = new Date().toISOString();
  const staffRoleSet = new Set(CONFIG.staffRoles.map(r => r.toLowerCase()));

  let added = 0, updated = 0, removed = 0;
  const db = loadDB();
  const currentIds = new Set();

  for (const [, member] of guild.members.cache) {
    const memberRoleNames = member.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => r.name);

    const staffRolesOnMember = memberRoleNames.filter(r =>
      staffRoleSet.has(r.toLowerCase())
    );
    if (staffRolesOnMember.length === 0) continue;

    const highestRole = CONFIG.staffRoles.find(r =>
      staffRolesOnMember.map(x => x.toLowerCase()).includes(r.toLowerCase())
    ) || staffRolesOnMember[0];

    // Determine group
    let roleGroup = 'Staff';
    for (const [group, roles] of Object.entries(CONFIG.roleGroups)) {
      if (roles.some(r => r.toLowerCase() === highestRole.toLowerCase())) {
        roleGroup = group;
        break;
      }
    }

    const onLoa = memberRoleNames.some(r => r.toLowerCase() === CONFIG.loaRole.toLowerCase());
    const onZtp = memberRoleNames.some(r => r.toLowerCase() === CONFIG.ztpRole.toLowerCase());

    // Strikes
    const strikes = CONFIG.strikeRoles.filter(s =>
      memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase())
    );

    // Permissions
    const perms = CONFIG.permRoles.filter(p =>
      memberRoleNames.some(r => r.toLowerCase() === p.toLowerCase())
    );

    // Sub teams
    const subTeams = CONFIG.subTeamRoles.filter(t =>
      memberRoleNames.some(r => r.toLowerCase() === t.toLowerCase())
    );

    const existing = db.staff[member.id];
    currentIds.add(member.id);

    db.staff[member.id] = {
      user_id:      member.id,
      username:     member.user.tag,
      nickname:     member.nickname || null,
      roles:        staffRolesOnMember,
      highest_role: highestRole,
      role_group:   roleGroup,
      join_date:    member.joinedAt ? member.joinedAt.toISOString() : null,
      on_loa:       onLoa,
      on_ztp:       onZtp,
      strikes:      strikes,
      perms:        perms,
      sub_teams:    subTeams,
      notes:        existing?.notes || '',
      added_at:     existing?.added_at || now,
      updated_at:   now,
    };

    if (existing) updated++; else added++;
  }

  for (const id of Object.keys(db.staff)) {
    if (!currentIds.has(id)) { delete db.staff[id]; removed++; }
  }

  db.sync_log.unshift({ synced_at: now, added, updated, removed });
  if (db.sync_log.length > 20) db.sync_log = db.sync_log.slice(0, 20);

  saveDB(db);
  console.log(`[SYNC] Done! +${added} added, ~${updated} updated, -${removed} removed. Total: ${currentIds.size}`);
}

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await syncStaff();
  console.log(`[BOT] Sync complete. Shutting down.`);
  await client.destroy();
  process.exit(0);
});

client.login(CONFIG.token);
