const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,

  // Staff roles in order highest to lowest
  staffRoles: [
    '➜ Chairman',
    '➜ Vice Chairman',
    'Director',
    'Deputy Director',
    'Assistant Director',
    '➜ Directive Team',
    'Disciplinary Director',
    'Recruitment Director',
    'Management Director',
    'Internal Affairs Director',
    'In-Game Director',
    'Community Director',
    'Lead Management',
    'Senior Management',
    'Management',
    'Junior Management',
    'Trial Management',
    '➜ Management Team',
    'Lead Affairs Team',
    'Senior Affairs Team',
    'Affairs Team',
    'Junior Affairs Team',
    'Trial Affairs Team',
    '➜ Internal Affairs Team',
    'Senior Administrator',
    'Administrator',
    'Junior Administrator',
    'Trial Administrator',
    '➜ Administration Team',
    'Senior Moderator',
    'Moderator',
    'Junior Moderator',
    'Trial Moderator',
    '➜ Moderation Team',
    '➜ Staff Team',
  ],

  // Role hierarchy groups for display ordering
  roleGroups: {
    'Chairman Team': [
      '➜ Chairman',
      '➜ Vice Chairman',
    ],
    'Directive Management': [
      'Director',
      'Deputy Director',
      'Assistant Director',
      '➜ Directive Team',
      'Disciplinary Director',
      'Recruitment Director',
      'Management Director',
      'Internal Affairs Director',
      'In-Game Director',
      'Community Director',
    ],
    'Management Team': [
      'Lead Management',
      'Senior Management',
      'Management',
      'Junior Management',
      'Trial Management',
      '➜ Management Team',
      'Lead Affairs Team',
      'Senior Affairs Team',
      'Affairs Team',
      'Junior Affairs Team',
      'Trial Affairs Team',
      '➜ Internal Affairs Team',
    ],
    'Admin Team': [
      'Senior Administrator',
      'Administrator',
      'Junior Administrator',
      'Trial Administrator',
      '➜ Administration Team',
    ],
    'Mod Team': [
      'Senior Moderator',
      'Moderator',
      'Junior Moderator',
      'Trial Moderator',
      '➜ Moderation Team',
    ],
    'Staff': [
      '➜ Staff Team',
    ],
  },

  // Strike roles (exact names)
  strikeRoles: [
    '➜ Strike 3 (Termination)',
    '➜ Strike 2 (Demotion)',
    '➜ Strike 1',
    'Warning 3 (Strike)',
    'Warning 2',
    'Warning 1',
    'Verbal Warning',
  ],

  // Permission roles (exact names)
  permRoles: [
    '50 / 50 Shift Permission',
    'Off Duty Command Permission',
    'Session Host Permission',
    'Promotion Permission',
    'Infraction Permission',
  ],

  // Sub team roles (exact names)
  subTeamRoles: [
    '➜ Media Team',
    '➜ Event Team',
    '➜ Social Media Team',
    '➜ Education & Training Team',
  ],

  // Special status roles
  specialRoles: [
    '➜ Blacklisted Staff',
    '➜ Under Investigation',
    '➜ Terminated Staff',
    '➜ Suspended',
    'Zero Tolerance Policy',
    '➜ Staff of the Week',
    'Age Verified',
  ],

  ztpRole: 'Zero Tolerance Policy',
};

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

    // Find highest role by position in staffRoles list
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

    const onZtp = memberRoleNames.some(r => r.toLowerCase() === CONFIG.ztpRole.toLowerCase());

    const strikes = CONFIG.strikeRoles.filter(s =>
      memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase())
    );

    const perms = CONFIG.permRoles.filter(p =>
      memberRoleNames.some(r => r.toLowerCase() === p.toLowerCase())
    );

    const subTeams = CONFIG.subTeamRoles.filter(t =>
      memberRoleNames.some(r => r.toLowerCase() === t.toLowerCase())
    );

    const special = CONFIG.specialRoles.filter(s =>
      memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase())
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
      on_ztp:       onZtp,
      strikes:      strikes,
      perms:        perms,
      sub_teams:    subTeams,
      special:      special,
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
