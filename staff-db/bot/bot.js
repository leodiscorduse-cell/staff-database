const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  melonlyToken: process.env.MELONLY_TOKEN || null,
  melonlyBase: 'https://api.melonly.xyz/api/v1',

  staffRoles: [
    '➜ Chairman', '➜ Vice Chairman',
    'Director', 'Deputy Director', 'Assistant Director', '➜ Directive Team',
    'Disciplinary Director', 'Recruitment Director', 'Management Director',
    'Internal Affairs Director', 'In-Game Director', 'Community Director',
    'Lead Management', 'Senior Management', 'Management', 'Junior Management', 'Trial Management', '➜ Management Team',
    'Lead Affairs Team', 'Senior Affairs Team', 'Affairs Team', 'Junior Affairs Team', 'Trial Affairs Team', '➜ Internal Affairs Team',
    'Senior Administrator', 'Administrator', 'Junior Administrator', 'Trial Administrator', '➜ Administration Team',
    'Senior Moderator', 'Moderator', 'Junior Moderator', 'Trial Moderator', '➜ Moderation Team',
    '➜ Staff Team',
  ],

  roleGroups: {
    'Chairman Team':          ['➜ Chairman', '➜ Vice Chairman'],
    'Directive Team':         ['Director', 'Deputy Director', 'Assistant Director', '➜ Directive Team', 'Disciplinary Director', 'Recruitment Director', 'Internal Affairs Director', 'In-Game Director', 'Community Director'],
    'Management Team':        ['Management Director', 'Lead Management', 'Senior Management', 'Management', 'Junior Management', 'Trial Management', '➜ Management Team'],
    'Internal Affairs Team':  ['Lead Affairs Team', 'Senior Affairs Team', 'Affairs Team', 'Junior Affairs Team', 'Trial Affairs Team', '➜ Internal Affairs Team'],
    'Admin Team':             ['Senior Administrator', 'Administrator', 'Junior Administrator', 'Trial Administrator', '➜ Administration Team'],
    'Mod Team':               ['Senior Moderator', 'Moderator', 'Junior Moderator', 'Trial Moderator', '➜ Moderation Team'],
    'Staff':                  ['➜ Staff Team'],
  },

  strikeRoles: ['➜ Strike 3 (Termination)', '➜ Strike 2 (Demotion)', '➜ Strike 1', 'Warning 3 (Strike)', 'Warning 2', 'Warning 1', 'Verbal Warning'],
  permRoles:   ['50 / 50 Shift Permission', 'Off Duty Command Permission', 'Session Host Permission', 'Promotion Permission', 'Infraction Permission'],
  subTeamRoles:['➜ Media Team', '➜ Event Team', '➜ Social Media Team', '➜ Education & Training Team'],
  specialRoles:['➜ Blacklisted Staff', '➜ Under Investigation', '➜ Terminated Staff', '➜ Suspended', 'Zero Tolerance Policy', '➜ Staff of the Week', 'Age Verified'],
  ztpRole:     'Zero Tolerance Policy',
};

const DB_PATH = path.join(__dirname, '..', 'staff.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ staff: {}, sync_log: [], melonly: { shifts: [], logs: [], loas: [], lastFetch: null } }, null, 2));
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

// ── Melonly API helper ────────────────────────────────────────────────────────
async function melonlyFetch(path, label) {
  if (!CONFIG.melonlyToken) return null;
  try {
    const res = await fetch(`${CONFIG.melonlyBase}${path}`, {
      headers: { Authorization: `Bearer ${CONFIG.melonlyToken}` }
    });
    if (!res.ok) { console.warn(`[MELONLY] ${label} failed: ${res.status}`); return null; }
    return await res.json();
  } catch (e) { console.warn(`[MELONLY] ${label} error:`, e.message); return null; }
}

async function fetchAllPages(endpoint, label) {
  const results = [];
  let page = 1;
  while (true) {
    const data = await melonlyFetch(`${endpoint}?page=${page}&limit=100`, `${label} p${page}`);
    if (!data || !data.data || data.data.length === 0) break;
    results.push(...data.data);
    if (page >= data.totalPages) break;
    page++;
    await new Promise(r => setTimeout(r, 300)); // be polite with rate limits
  }
  return results;
}

// ── Sync Melonly data ─────────────────────────────────────────────────────────
async function syncMelonly(db) {
  if (!CONFIG.melonlyToken) { console.log('[MELONLY] No token set, skipping.'); return; }
  console.log('[MELONLY] Fetching shifts, logs and LOAs...');

  const [shifts, logs, loas] = await Promise.all([
    fetchAllPages('/server/shifts', 'shifts'),
    fetchAllPages('/server/logs', 'logs'),
    fetchAllPages('/server/loas', 'loas'),
  ]);

  // Enrich each staff member with their Melonly activity
  for (const [discordId, member] of Object.entries(db.staff)) {
    // Get melonly member by discord ID
    const melMember = await melonlyFetch(`/server/members/discord/${discordId}`, `member ${discordId}`);
    if (!melMember) continue;

    const memberId = melMember.id;

    // Filter shifts for this member
    const memberShifts = shifts.filter(s => s.memberId === memberId);
    const completedShifts = memberShifts.filter(s => s.endedAt);
    const totalSeconds = completedShifts.reduce((acc, s) => {
      return acc + ((s.endedAt - s.createdAt) / 1000); // ms to seconds
    }, 0);
    const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;
    const lastShift = completedShifts.sort((a, b) => b.endedAt - a.endedAt)[0];

    // Filter LOAs for this member
    const memberLoas = loas.filter(l => l.memberId === memberId);
    const activeLoa = memberLoas.find(l => l.status === 1 && !l.endedAt);

    db.staff[discordId].melonly = {
      memberId,
      totalShifts:  completedShifts.length,
      totalHours,
      lastShiftAt:  lastShift ? new Date(lastShift.endedAt).toISOString() : null,
      onLoa:        !!activeLoa,
      loaReason:    activeLoa?.reason || null,
      loaEndsAt:    activeLoa ? new Date(activeLoa.endAt).toISOString() : null,
    };

    await new Promise(r => setTimeout(r, 200));
  }

  // Store recent global data
  db.melonly = {
    shifts:    shifts.slice(0, 200),
    logs:      logs.slice(0, 200),
    loas:      loas.filter(l => l.status === 1).slice(0, 100),
    lastFetch: new Date().toISOString(),
  };

  console.log(`[MELONLY] Done. ${shifts.length} shifts, ${logs.length} logs, ${loas.length} LOAs fetched.`);
}

// ── Discord sync ──────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] });

async function syncStaff() {
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) { console.error(`[ERROR] Guild not found.`); return; }
  console.log(`[SYNC] Syncing "${guild.name}"...`);
  await guild.members.fetch();

  const now = new Date().toISOString();
  const staffRoleSet = new Set(CONFIG.staffRoles.map(r => r.toLowerCase()));
  let added = 0, updated = 0, removed = 0;
  const db = loadDB();
  if (!db.melonly) db.melonly = { shifts: [], logs: [], loas: [], lastFetch: null };
  const currentIds = new Set();

  for (const [, member] of guild.members.cache) {
    const memberRoleNames = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name);
    const staffRolesOnMember = memberRoleNames.filter(r => staffRoleSet.has(r.toLowerCase()));
    if (staffRolesOnMember.length === 0) continue;

    const highestRole = CONFIG.staffRoles.find(r => staffRolesOnMember.map(x => x.toLowerCase()).includes(r.toLowerCase())) || staffRolesOnMember[0];
    let roleGroup = 'Staff';
    for (const [group, roles] of Object.entries(CONFIG.roleGroups)) {
      if (roles.some(r => r.toLowerCase() === highestRole.toLowerCase())) { roleGroup = group; break; }
    }

    const onZtp      = memberRoleNames.some(r => r.toLowerCase() === CONFIG.ztpRole.toLowerCase());
    const strikes    = CONFIG.strikeRoles.filter(s => memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase()));
    const perms      = CONFIG.permRoles.filter(p => memberRoleNames.some(r => r.toLowerCase() === p.toLowerCase()));
    const subTeams   = CONFIG.subTeamRoles.filter(t => memberRoleNames.some(r => r.toLowerCase() === t.toLowerCase()));
    const special    = CONFIG.specialRoles.filter(s => memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase()));
    const existing   = db.staff[member.id];
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
      strikes, perms, sub_teams: subTeams, special,
      notes:        existing?.notes || '',
      melonly:      existing?.melonly || null,
      added_at:     existing?.added_at || now,
      updated_at:   now,
    };
    if (existing) updated++; else added++;
  }

  for (const id of Object.keys(db.staff)) { if (!currentIds.has(id)) { delete db.staff[id]; removed++; } }
  db.sync_log.unshift({ synced_at: now, added, updated, removed });
  if (db.sync_log.length > 20) db.sync_log = db.sync_log.slice(0, 20);

  console.log(`[SYNC] +${added} added, ~${updated} updated, -${removed} removed. Total: ${currentIds.size}`);

  // Now sync Melonly if token available
  await syncMelonly(db);

  saveDB(db);
}

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  await syncStaff();
  console.log(`[BOT] All done. Shutting down.`);
  await client.destroy();
  process.exit(0);
});

client.login(CONFIG.token);
