// Execute production room recording/reset/snapshot and warm adoption with a modeled clock/mutex.
// Real ring, age and CRC helpers remain linked. This is not device/NVS restoration evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync("main/history.cpp", "utf8");
const take = (name) => {
  const start = source.indexOf(name);
  assert.ok(start >= 0 && source.indexOf(name, start + name.length) < 0, `unique production ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 1, end = brace + 1;
  while (end < source.length && depth) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  assert.ok(brace > start && depth === 0, `bounded production ${name}`);
  return source.slice(start, end);
};
const structStart = source.indexOf("struct RoomPersistedHistory {");
const structEnd = source.indexOf("\n};", structStart);
assert.ok(structStart >= 0 && structEnd > structStart);
const functions = ["inline uint32_t persist_crc_ring(", "inline uint32_t room_crc()",
  "inline void room_seal_locked()", "inline void room_wipe_locked(", "void room_start_locked(",
  "inline void bump_history_epoch()", "uint32_t history_epoch()", "uint32_t history_room_generation()",
  "bool history_room_matches(", "void history_room_reset(", "void history_record_room(",
  "static void clear_snapshot_meta(", "static void fill_snapshot_meta_locked(",
  "size_t history_room_snapshot("].map(take).join("\n");
const fixture = String.raw`
#include "logic/history_persist.hpp"
#include "logic/state_dwell.hpp"
#include <atomic>
#include <cstring>
#include <cstdio>
#include <stdexcept>
namespace daik {
using namespace logic;
` + source.slice(structStart, structEnd + 3) + String.raw`
RoomPersistedHistory store;
RoomPersistedHistory& R() { return store; }
HistoryLiveness s_room_liveness{};
std::atomic<uint32_t> s_room_identity{0}, s_room_generation{1}, s_history_epoch{1};
std::atomic<bool> s_flash_forgotten{false};
void* s_mtx = reinterpret_cast<void*>(1);
void* s_flash_mtx = reinterpret_cast<void*>(2);
bool s_room_have_bucket=false, s_room_fed=false;
uint32_t s_room_bucket=0;
int64_t now_us=0, s_room_last_commit_us=INT64_MIN, s_room_last_commit_bucket=-1;
int64_t s_room_adopt_real_end_us=INT64_MIN, s_room_adopt_floor_bucket=INT64_MIN;
int64_t s_flash_last_bucket[HISTORY_JOURNAL_SOURCE_COUNT];
int64_t s_flash_newest_bucket[HISTORY_JOURNAL_SOURCE_COUNT];
int64_t s_flash_oldest_bucket[HISTORY_JOURNAL_SOURCE_COUNT];
uint16_t s_flash_restore_slot_count[HISTORY_JOURNAL_SOURCE_COUNT]{};
constexpr int64_t kNoCommitUs=INT64_MIN;
int64_t esp_timer_get_time() { return now_us; }
struct Lock { explicit Lock(void*) {} bool acquired() const { return true; } };
` + functions + String.raw`
void need(bool ok, const char* why) { if(!ok) throw std::runtime_error(why); }
void runtime_boot(uint32_t id, CrashReason reason=CrashReason::SW, bool safe=false) {
 s_room_have_bucket=false; s_room_fed=false; s_room_bucket=0;
 s_room_last_commit_us=INT64_MIN; s_room_last_commit_bucket=-1;
 s_room_adopt_real_end_us=s_room_adopt_floor_bucket=INT64_MIN;
 now_us=0;
 room_start_locked(id, static_cast<uint32_t>(reason), safe, now_us);
}
void read_check(uint32_t id, size_t expected) {
 HistorySample v[HISTORY_SAMPLES]; uint32_t epoch=0; HistoryMeta meta;
 need(history_room_snapshot(v,HISTORY_SAMPLES,id,&epoch,&meta)==expected,"snapshot length");
 need(epoch==history_epoch(),"snapshot epoch");
}
void run() {
 constexpr uint32_t A=101, B=202;
 runtime_boot(A,CrashReason::POWERON);
 auto gen=history_room_generation();
 now_us=1000000; history_record_room(true,23.6,gen);
 need(R().ring.pending==236,"first pending actual");
 now_us=300000000; history_record_room(true,24.0,gen);
 read_check(A,1); HistorySample value=0;
 need(R().ring.sample_from_newest(0,value)&&value==236,"completed bucket actual");
 now_us=600000000; history_record_room(false,0,gen);
 now_us=900000000; history_record_room(false,0,gen);
 need(R().ring.sample_from_newest(0,value)&&value==HISTORY_NO_READING,"outage remains gap");
 need(R().ring.sample_from_newest(1,value)&&value==240,"previous good bucket retained");
 auto epoch=history_epoch(); history_room_reset(A);
 need(history_epoch()==epoch&&history_room_generation()==gen&&R().ring.count==3,"same binding preserves ring");
 history_room_reset(B);
 need(history_epoch()!=epoch&&history_room_generation()!=gen,"source change retires generation");
 need(R().ring.count==0&&R().identity==B,"source change clears only room store");
 history_record_room(true,99.0,gen);
 need(!s_room_fed&&R().ring.count==0&&R().ring.pending==HISTORY_NO_READING,"old in-flight sample refused");
 HistorySample v[HISTORY_SAMPLES]; uint32_t e=0; HistoryMeta meta;
 need(history_room_snapshot(v,HISTORY_SAMPLES,A,&e,&meta)==0&&e==0&&meta.oldest_bucket==-1,"old HTTP config refused");
 history_record_room(true,26.0,history_room_generation());
 need(R().ring.pending==260&&s_room_fed,"new generation accepted");
 history_room_reset(0); history_record_room(true,27.0,history_room_generation());
 need(R().ring.count==0&&!s_room_fed,"deleted source stays absent");

 // The measured stall becomes explicit gaps; open data and repeated uncommitted adoption do not.
 room_wipe_locked(A); runtime_boot(A);
 now_us=1000000; history_record_room(true,23.6,history_room_generation());
 now_us=300000000; history_record_room(true,24.0,history_room_generation());
 history_liveness_touch(s_room_liveness,1200000000);
 runtime_boot(A);
 need(R().ring.count==4,"warm restart books three unobserved intervals");
 need(R().ring.pending==HISTORY_NO_READING,"warm restart discards open bucket");
 need(R().ring.sample_from_newest(3,value)&&value==236,"warm restart preserves measured point");
 need(R().ring.sample_from_newest(0,value)&&value==HISTORY_NO_READING,"warm seam is a gap");
 runtime_boot(A);
 need(R().ring.count==0,"uncommitted restart refuses repeat adoption");

 room_wipe_locked(A); runtime_boot(A);
 now_us=1000000; history_record_room(true,23.6,history_room_generation());
 now_us=300000000; history_record_room(false,0,history_room_generation());
 history_liveness_touch(s_room_liveness,301000000);
 runtime_boot(B);
 need(R().ring.count==0&&R().identity==B,"warm restart cannot restore another binding");
 room_wipe_locked(A); runtime_boot(A);
 now_us=1000000; history_record_room(true,23.6,history_room_generation());
 now_us=300000000; history_record_room(false,0,history_room_generation());
 runtime_boot(A,CrashReason::POWERON);
 need(R().ring.count==0,"cold restart refuses RAM");
 runtime_boot(0,CrashReason::SW,true);
 need(R().identity==0&&R().ring.count==0,"safe mode retires room source");
}
}
int main(){try{daik::run();std::puts("room history runtime passed");return 0;}
catch(const std::exception& e){std::fprintf(stderr,"%s\n",e.what());return 1;}}
`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"daikin-room-history-"));
try {
  const run = (text,name) => {
    const cpp=path.join(dir,name+".cpp"),bin=path.join(dir,name);
    fs.writeFileSync(cpp,text);
    const build=spawnSync(process.env.CXX||"c++",["-std=c++17","-Wall","-Wextra","-Werror","-I","main",cpp,"-o",bin],{encoding:"utf8"});
    assert.equal(build.status,0,build.stderr);
    return spawnSync(bin,[],{encoding:"utf8"});
  };
  const good=run(fixture,"base"); assert.equal(good.status,0,good.stderr);
  for(const [name,before,after] of [
    ["late-generation","generation != s_room_generation.load()","(static_cast<void>(generation), false)"],
    ["wrong-warm-source","R().identity == want_room","true"],
    ["warm-gap-booking","R().ring.append_gaps(booking.gaps);","(void)booking.gaps;"],
  ]) {
    assert.equal(fixture.split(before).length,2,`one mutation site ${name}`);
    const bad=run(fixture.replace(before,after),name);
    assert.notEqual(bad.status,0,`${name}: broken production path must fail`);
  }
  console.log("room history: production recorder, source cutover, snapshot and warm adoption; three negative controls passed");
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
