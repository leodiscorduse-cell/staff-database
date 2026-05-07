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
    const fullUrl = `${CONFIG.melonlyBase}${endpoint}`;
    const res = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${CONFIG.melonlyToken}` }
    });
    if (res.status === 404) {
      console.debug(`[MELONLY] ${label}: 404 (not found)`);
      return null;
    }
    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[MELONLY] ${label} → ${res.status}: ${errorText.substring(0, 100)}`);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (e) { 
    console.warn(`[MELONLY] ${label} error: ${e.message}`);
    return null;
  }
}

async function fetchAllPages(endpoint, label) {
  const results = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore && page <= 50) { // Max 50 pages safety limit
    const sep = endpoint.includes('?') ? '&' : '?';
    const data = await melonlyFetch(`${endpoint}${sep}page=${page}&limit=100`, `${label} p${page}`);
    
    if (!data) {
      console.debug(`[MELONLY] ${label}: No data for page ${page}`);
      break;
    }
    
    // Handle different response formats
    const items = data.data || data.shifts || data.logs || data.loas || (Array.isArray(data) ? data : []);
    if (!items || !items.length) {
      hasMore = false;
      break;
    }
    
    results.push(...items);
    hasMore = page < (data.totalPages || page);
    page++;
    await sleep(300);
  }
  
  console.log(`[MELONLY] ${label}: Fetched ${results.length} records`);
  return results;
}

async function syncMelonly(db, discordIds) {
  if (!CONFIG.melonlyToken) { 
    console.log('[MELONLY] No token, skipping.'); 
    return; 
  }
  
  console.log('[MELONLY] Starting sync...');
  console.log(`[MELONLY] Token present: ${CONFIG.melonlyToken.substring(0, 20)}...`);

  // Step 1: fetch critical data
  console.log('[MELONLY] Fetching shifts, logs, LOAs...');
  const [allShifts, allLogs, allLoas] = await Promise.all([
    fetchAllPages('/server/shifts', 'shifts'),
    fetchAllPages('/server/logs', 'logs'),
    fetchAllPages('/server/loas', 'loas'),
  ]);
  console.log(`[MELONLY] Fetched: ${allShifts.length} shifts, ${allLogs.length} logs, ${allLoas.length} LOAs`);

  if (allShifts.length === 0 && allLogs.length === 0 && allLoas.length === 0) {
    console.warn('[MELONLY] ⚠️ No data returned from Melonly API. Check token and server ID.');
  }

  // Step 2: Build member lookup maps
  const melonyToDiscord = {};
  const discordToMelony = {};
  let lookupSuccess = 0;

  console.log(`[MELONLY] Looking up ${discordIds.length} Discord staff to Melonly members...`);
  
  for (const discordId of discordIds) {
    // Try multiple endpoint variations
    let member = null;
    
    // Try standard Discord lookup first
    member = await melonlyFetch(`/server/members/discord/${discordId}`, `lookup-discord ${discordId}`);
    
    if (!member) {
      // Try alternative endpoint
      member = await melonlyFetch(`/server/members?discordId=${discordId}`, `lookup-param ${discordId}`);
    }
    
    if (member?.id) {
      melonyToDiscord[member.id] = discordId;
      discordToMelony[discordId] = member.id;
      lookupSuccess++;
    }
    
    await sleep(150);
  }
  
  console.log(`[MELONLY] ✓ Matched ${lookupSuccess}/${discordIds.length} staff to Melonly`);
  
  if (lookupSuccess === 0) {
    console.warn('[MELONLY] ⚠️ No staff matched to Melonly. Possible causes:');
    console.warn('  - Discord IDs not linked in Melonly');
    console.warn('  - API token invalid or expired');
    console.warn('  - Wrong server ID in config');
  }

  // Step 3: Calculate per-staff stats
  let enriched = 0;
  for (const [discordId, melonyId] of Object.entries(discordToMelony)) {
    if (!db.staff[discordId]) continue;

    // Find shifts for this member
    const memberShifts = allShifts.filter(s => {
      // Try different field names
      return s.memberId === melonyId || s.userId === melonyId || 
             s.discordId === discordId || s.staffId === melonyId;
    });
    
    const completed = memberShifts.filter(s => s.endedAt);
    const totalMs = completed.reduce((a, s) => a + (Math.max(0, (s.endedAt || s.createdAt) - (s.createdAt || s.startedAt))), 0);
    const totalHours = Math.round((totalMs / 3600000) * 10) / 10;
    const lastShift = completed.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];

    // LOA check
    const memberLoas = allLoas.filter(l => l.memberId === melonyId || l.userId === melonyId || l.discordId === discordId);
    const activeLoa = memberLoas.find(l => l.status === 1 || l.active === true);

    db.staff[discordId].melonly = {
      melonyId,
      totalShifts:   Math.max(0, completed.length),
      totalHours:    Math.max(0, totalHours),
      lastShiftAt:   lastShift ? new Date(lastShift.endedAt || lastShift.createdAt).toISOString() : null,
      onLoa:         !!activeLoa,
      loaReason:     activeLoa?.reason || null,
      loaEndsAt:     activeLoa?.endAt ? new Date(activeLoa.endAt).toISOString() : null,
      shiftCount:    memberShifts.length,
    };
    
    enriched++;
  }

  // Step 4: Enrich shifts with Discord names
  const enrichedShifts = allShifts
    .filter(s => s.endedAt || s.completedAt)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, 100)
    .map(s => {
      const memberId = s.memberId || s.userId || s.staffId;
      const discordId = melonyToDiscord[memberId];
      const staffMember = discordId ? db.staff[discordId] : null;
      return {
        ...s,
        discordId:   discordId || null,
        displayName: staffMember?.nickname || staffMember?.username?.split('#')[0] || 'Unknown',
        highestRole: staffMember?.highest_role || null,
        durationMs:  Math.max(0, (s.endedAt || s.completedAt || 0) - (s.createdAt || s.startedAt || 0)),
      };
    });

  // Step 5: Enrich logs
  const enrichedLogs = allLogs.slice(0, 200).map(l => {
    const memberId = l.memberId || l.userId || l.staffId;
    const discordId = melonyToDiscord[memberId];
    const staffMember = discordId ? db.staff[discordId] : null;
    return {
      ...l,
      discordId,
      staffName: staffMember?.nickname || staffMember?.username?.split('#')[0] || l.username || 'Unknown',
    };
  });

  // Step 6: Enrich active LOAs
  const activeLoas = allLoas
    .filter(l => l.status === 1 || l.active === true || (l.endAt && new Date(l.endAt) > new Date()))
    .map(l => {
      const memberId = l.memberId || l.userId || l.staffId;
      const discordId = melonyToDiscord[memberId];
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
    stats:     {
      totalMatched: lookupSuccess,
      totalEnriched: enriched,
      shiftsCount: allShifts.length,
      logsCount: allLogs.length,
      loasCount: allLoas.length,
    },
  };

  console.log(`[MELONLY] ✓ Done. ${enriched} staff enriched with Melonly activity data.`);
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
