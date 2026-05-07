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
    'Chairman Team':         ['➜ Chairman', '➜ Vice Chairman'],
    'Directive Team':        ['Director', 'Deputy Director', 'Assistant Director', '➜ Directive Team', 'Disciplinary Director', 'Recruitment Director', 'Internal Affairs Director', 'In-Game Director', 'Community Director'],
    'Management Team':       ['Management Director', 'Lead Management', 'Senior Management', 'Management', 'Junior Management', 'Trial Management', '➜ Management Team'],
    'Internal Affairs Team': ['Lead Affairs Team', 'Senior Affairs Team', 'Affairs Team', 'Junior Affairs Team', 'Trial Affairs Team', '➜ Internal Affairs Team'],
    'Admin Team':            ['Senior Administrator', 'Administrator', 'Junior Administrator', 'Trial Administrator', '➜ Administration Team'],
    'Mod Team':              ['Senior Moderator', 'Moderator', 'Junior Moderator', 'Trial Moderator', '➜ Moderation Team'],
    'Staff':                 ['➜ Staff Team'],
  },

  strikeRoles:  ['➜ Strike 3 (Termination)', '➜ Strike 2 (Demotion)', '➜ Strike 1', 'Warning 3 (Strike)', 'Warning 2', 'Warning 1', 'Verbal Warning'],
  permRoles:    ['50 / 50 Shift Permission', 'Off Duty Command Permission', 'Session Host Permission', 'Promotion Permission', 'Infraction Permission'],
  subTeamRoles: ['➜ Media Team', '➜ Event Team', '➜ Social Media Team', '➜ Education & Training Team'],
  specialRoles: ['➜ Blacklisted Staff', '➜ Under Investigation', '➜ Terminated Staff', '➜ Suspended', 'Zero Tolerance Policy', '➜ Staff of the Week', 'Age Verified'],
  ztpRole:      'Zero Tolerance Policy',
};

const DB_PATH = path.join(__dirname, '..', 'staff.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ staff: {}, sync_log: [], melonly: { shifts: [], logs: [], loas: [], lastFetch: null } }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function melonlyFetch(endpoint, label) {
  if (!CONFIG.melonlyToken) return null;
  try {
    const res = await fetch(`${CONFIG.melonlyBase}${endpoint}`, {
      headers: { Authorization: `Bearer ${CONFIG.melonlyToken}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) { console.warn(`[MELONLY] ${label} → ${res.status}`); return null; }
    return await res.json();
  } catch (e) { console.warn(`[MELONLY] ${label} error: ${e.message}`); return null; }
}

async function fetchAllPages(endpoint, label) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await melonlyFetch(`${endpoint}${sep}page=${page}&limit=100`, `${label} p${page}`);
    if (!data?.data?.length) break;
    results.push(...data.data);
    if (page >= data.totalPages) break;
    page++;
    await sleep(300);
  }
  return results;
}

async function syncMelonly(db, discordIds) {
  if (!CONFIG.melonlyToken) { console.log('[MELONLY] No token, skipping.'); return; }
  console.log('[MELONLY] Starting sync...');

  // Step 1: fetch all shifts, logs, loas in parallel
  const [allShifts, allLogs, allLoas] = await Promise.all([
    fetchAllPages('/server/shifts', 'shifts'),
    fetchAllPages('/server/logs', 'logs'),
    fetchAllPages('/server/loas', 'loas'),
  ]);
  console.log(`[MELONLY] Fetched ${allShifts.length} shifts, ${allLogs.length} logs, ${allLoas.length} LOAs`);

  // Step 2: for each staff Discord ID, look up their Melonly member ID
  // Build map: melonyMemberId → discordId
  const melonyToDiscord = {};
  const discordToMelony = {};

  console.log(`[MELONLY] Looking up ${discordIds.length} staff members...`);
  for (const discordId of discordIds) {
    const member = await melonlyFetch(`/server/members/discord/${discordId}`, `lookup ${discordId}`);
    if (member?.id) {
      melonyToDiscord[member.id] = discordId;
      discordToMelony[discordId] = member.id;
    }
    await sleep(150);
  }
  console.log(`[MELONLY] Matched ${Object.keys(discordToMelony).length} staff to Melonly`);

  // Step 3: calculate per-staff stats from shifts
  for (const [discordId, melonyId] of Object.entries(discordToMelony)) {
    if (!db.staff[discordId]) continue;

    const memberShifts = allShifts.filter(s => s.memberId === melonyId);
    const completed = memberShifts.filter(s => s.endedAt);
    const totalMs = completed.reduce((a, s) => a + (s.endedAt - s.createdAt), 0);
    const totalHours = Math.round((totalMs / 3600000) * 10) / 10;
    const lastShift = completed.sort((a, b) => b.endedAt - a.endedAt)[0];

    // LOA check
    const memberLoas = allLoas.filter(l => l.memberId === melonyId);
    const activeLoa = memberLoas.find(l => l.status === 1 && !l.endedAt);

    db.staff[discordId].melonly = {
      melonyId,
      totalShifts:  completed.length,
      totalHours,
      lastShiftAt:  lastShift ? new Date(lastShift.endedAt).toISOString() : null,
      onLoa:        !!activeLoa,
      loaReason:    activeLoa?.reason || null,
      loaEndsAt:    activeLoa?.endAt ? new Date(activeLoa.endAt).toISOString() : null,
    };
  }

  // Step 4: enrich recent shifts with Discord info for the dashboard
  const enrichedShifts = allShifts
    .filter(s => s.endedAt)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 100)
    .map(s => {
      const discordId = melonyToDiscord[s.memberId];
      const staffMember = discordId ? db.staff[discordId] : null;
      return {
        ...s,
        discordId:    discordId || null,
        displayName:  staffMember?.nickname || staffMember?.username?.split('#')[0] || 'Unknown',
        highestRole:  staffMember?.highest_role || null,
        durationMs:   s.endedAt - s.createdAt,
      };
    });

  // Step 5: enrich logs with names
  const enrichedLogs = allLogs.slice(0, 200).map(l => {
    const discordId = melonyToDiscord[l.memberId] || null;
    const staffMember = discordId ? db.staff[discordId] : null;
    return {
      ...l,
      discordId,
      staffName: staffMember?.nickname || staffMember?.username?.split('#')[0] || l.username || 'Unknown',
    };
  });

  // Step 6: enrich active LOAs with names
  const activeLoas = allLoas
    .filter(l => l.status === 1 && !l.endedAt)
    .map(l => {
      const discordId = melonyToDiscord[l.memberId] || null;
      const staffMember = discordId ? db.staff[discordId] : null;
      return {
        ...l,
        discordId,
        displayName: staffMember?.nickname || staffMember?.username?.split('#')[0] || 'Unknown',
        highestRole: staffMember?.highest_role || null,
      };
    });

  db.melonly = {
    shifts:    enrichedShifts,
    logs:      enrichedLogs,
    loas:      activeLoas,
    lastFetch: new Date().toISOString(),
  };

  console.log(`[MELONLY] Done. ${Object.keys(discordToMelony).length} staff enriched with activity data.`);
}

// ── Discord sync ──────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
});

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

    const highestRole = CONFIG.staffRoles.find(r =>
      staffRolesOnMember.map(x => x.toLowerCase()).includes(r.toLowerCase())
    ) || staffRolesOnMember[0];

    let roleGroup = 'Staff';
    for (const [group, roles] of Object.entries(CONFIG.roleGroups)) {
      if (roles.some(r => r.toLowerCase() === highestRole.toLowerCase())) { roleGroup = group; break; }
    }

    const onZtp    = memberRoleNames.some(r => r.toLowerCase() === CONFIG.ztpRole.toLowerCase());
    const strikes  = CONFIG.strikeRoles.filter(s => memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase()));
    const perms    = CONFIG.permRoles.filter(p => memberRoleNames.some(r => r.toLowerCase() === p.toLowerCase()));
    const subTeams = CONFIG.subTeamRoles.filter(t => memberRoleNames.some(r => r.toLowerCase() === t.toLowerCase()));
    const special  = CONFIG.specialRoles.filter(s => memberRoleNames.some(r => r.toLowerCase() === s.toLowerCase()));
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
      strikes, perms, sub_teams: subTeams, special,
      notes:        existing?.notes || '',
      melonly:      existing?.melonly || null,
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

  console.log(`[SYNC] Discord done: +${added} added, ~${updated} updated, -${removed} removed. Total: ${currentIds.size}`);

  // Sync Melonly with all Discord staff IDs
  await syncMelonly(db, [...currentIds]);

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
