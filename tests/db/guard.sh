#!/usr/bin/env bash
# Database integrity tests for the daily_sets guard, against a THROWAWAY local PostgreSQL loaded with the production
# structure, the full question bank and the original schedule (never a real Supabase project).
#   tests/db/guard.sh            needs PostgreSQL 16 binaries (initdb, pg_ctl, psql) and node
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1); P=$(mktemp -d); PORT=${PGPORT_TEST:-55433}
RUN() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$P"
RUN "$BIN/initdb -D $P/data -A trust -U postgres >/dev/null && $BIN/pg_ctl -D $P/data -o '-p $PORT -k $P' -l $P/log start >/dev/null"
trap 'RUN "$BIN/pg_ctl -D $P/data stop -m fast >/dev/null"; rm -rf "$P"' EXIT
export PGOPTIONS='-c test.today=2026-11-26'
S="psql -h $P -p $PORT -U postgres -q -At"
$S -c "create schema extensions; create schema auth; create role anon; create role authenticated;" >/dev/null
grep -v "pg_net\|pg_cron\|supabase_vault\|pg_graphql\|pg_stat_statements" supabase/snapshots/schema_2026-11-26_tables.sql | $S -f - >/dev/null 2>&1 || true
$S -c "create or replace function public.uk_today() returns date language sql stable as \$\$ select coalesce(nullif(current_setting('test.today', true), '')::date, (now() at time zone 'Europe/London')::date) \$\$;"
node --input-type=module -e "
import { loadGame } from './scripts/load-game.mjs'; const G = loadGame(); const q = s => s == null ? 'null' : \"'\" + String(s).replace(/'/g, \"''\") + \"'\";
console.log('insert into public.questions (id,question,answer,range_lo,range_hi,unit,category,difficulty,scoring,explanation,source,geo) values ' + G.BANK.map(x => '(' + [q(x.id), q(x.question), x.answer, x.range ? x.range[0] : 'null', x.range ? x.range[1] : 'null', q(x.unit), q(x.category), x.difficulty, q(x.scoring), q(x.explanation), q(x.source), q(x.geo)].join(',') + ')').join(',') + ';');
const rows = []; for (let d = '2026-10-26'; d <= '2029-10-29'; d = G.DateUK.add(d, 1)) rows.push('(' + q(d) + ',' + G.DateUK.puzzleNo(d) + ',array[' + G.legacyDailyIds(d).map(q).join(',') + '])');
console.log('insert into public.daily_sets values ' + rows.join(',') + ';');" | $S -v ON_ERROR_STOP=1 -f - >/dev/null
fails=0; ok(){ if [ "$2" = "$3" ]; then echo "PASS | $1"; else echo "FAIL | $1 (got $2, want $3)"; fails=$((fails+1)); fi; }
md5(){ $S -c "select md5(string_agg(puzzle_date::text||':'||array_to_string(question_ids,','), ';' order by puzzle_date)) from daily_sets $1"; }
ok "the copy matches production's 1,100 stored days" "$(md5 '')" "f46e68f1eaacc998ec1b4cd37ccaa867"
before=$(md5 "where puzzle_date <= '2026-11-26'")
$S -v ON_ERROR_STOP=1 -f supabase/migrations/20261126000000_question_integrity_sync.sql >/dev/null 2>&1
ok "published days are unchanged by the migration" "$(md5 "where puzzle_date <= '2026-11-26'")" "$before"
GAME=$(node --input-type=module -e "import { loadGame } from './scripts/load-game.mjs'; import c from 'node:crypto'; const G = loadGame(); const a=[]; for (let d='2026-10-26'; G.hasDaily(d); d=G.DateUK.add(d,1)) a.push(d+':'+G.dailyIds(d).join(',')); console.log(c.createHash('md5').update(a.join(';')).digest('hex'))")
ok "after the migration the database holds exactly the game's schedule" "$(md5 '')" "$GAME"
set -- $(node -e "const u=require('./content/question-usage.json'); console.log(Object.entries(u.questions).filter(([k,v])=>v.status==='reserve').map(([k])=>k).slice(0,13).join(' '))")
try(){ $S -c "$1" >/dev/null 2>&1 && echo accepted || echo refused; }
ok "editing a published day is refused" "$(try "update daily_sets set puzzle_no = puzzle_no where puzzle_date='2026-11-26'")" refused
ok "deleting a published day is refused" "$(try "delete from daily_sets where puzzle_date='2026-11-20'")" refused
ok "adding a past day is refused" "$(try "insert into daily_sets values ('2026-10-01', -24, array['$1','$2','$3','$4','$5','$6','$7'])")" refused
ok "reusing a published question is refused" "$(try "insert into daily_sets values ('2027-06-01', 219, array['u41','$2','$3','$4','$5','$6','$7'])")" refused
ok "reusing a fact through its twin question is refused" "$(try "insert into daily_sets values ('2027-06-01', 219, array['lm33','$2','$3','$4','$5','$6','$7'])")" refused
ok "a quarantined question is refused" "$(try "insert into daily_sets values ('2027-06-01', 219, array['y049','$2','$3','$4','$5','$6','$7'])")" refused
ok "6 questions is refused" "$(try "insert into daily_sets values ('2027-06-01', 219, array['$1','$2','$3','$4','$5','$6'])")" refused
ok "a valid new day from the reserve is accepted" "$(try "insert into daily_sets values ('2027-06-01', 219, array['$1','$2','$3','$4','$5','$6','$7'])")" accepted
ok "deleting an unpublished day is allowed" "$(try "delete from daily_sets where puzzle_date='2027-06-01'")" accepted
ok "the correction procedure can change a published day on purpose" "$(try "begin; set local dialin.correction = 'on'; update daily_sets set puzzle_no = puzzle_no where puzzle_date='2026-11-20'; commit;")" accepted
for run in 1 2 3; do
  ($S -c "begin; insert into daily_sets values ('2027-06-01', 219, array['$1','$2','$3','$4','$5','$6','$7']); select pg_sleep(1.2); commit;" >/dev/null 2>&1 &); sleep 0.3
  try "insert into daily_sets values ('2027-06-02', 220, array['$1','$8','$9','${10}','${11}','${12}','${13}'])" >/dev/null; sleep 1.3
  ok "race $run: two schedulers adding the same question at once: it ends up in one day only" "$($S -c "select count(*) from daily_sets where '$1' = any(question_ids)")" 1
  $S -c "delete from daily_sets where puzzle_date in ('2027-06-01','2027-06-02')" >/dev/null
done
$S -v ON_ERROR_STOP=1 -f supabase/migrations/20261126000000_question_integrity_sync.sql >/dev/null 2>&1
ok "applying the migration twice changes nothing" "$(md5 '')" "$GAME"
echo; [ $fails = 0 ] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
