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
#include <type_traits>
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
 auto* raw=reinterpret_cast<unsigned char*>(&R());
 std::memset(raw,0xa5,sizeof(R()));room_wipe_locked(A);
 need(R().magic==HISTORY_PERSIST_MAGIC&&R().version==HISTORY_PERSIST_VERSION&&
      R().schema==HISTORY_ROOM_SCHEMA&&R().identity==A,"wipe establishes room identity");
 need(R().boots_since_commit==0&&R().reserved==0&&R().residual_us==0,"wipe clears bookkeeping");
 need(R().ring.count==0&&R().ring.head==0&&R().ring.pending==HISTORY_NO_READING,"wipe restores absent pending sentinel");
 for(auto reading:R().ring.buf)need(reading==0,"wipe zeroes old sample bytes");
 need(R().crc==room_crc(),"wiped room seal matches actual bytes");
 unsigned char first[sizeof(R())];std::memcpy(first,raw,sizeof(first));
 std::memset(raw,0x5a,sizeof(R()));room_wipe_locked(A);
 need(std::memcmp(first,raw,sizeof(first))==0,"wipe deterministic from different retained bytes");
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
// Execute production restore/checkup/splice with guarded metadata and a deferred actual reset.
const restoreFunctions = ["void ring_replace_locked(", "bool splice_locked(",
  "static bool history_splice_snapshot(", "HistorySource source_of_slot(",
  "static void flash_restore_advance_to(", "static void history_restore_checkup_flash(",
  "logic::HistoryJournalSource journal_source(", "void history_service_flash_restore("].map(take).join("\n");
const journalStart = source.indexOf("struct FlashJournalRecord {");
const journalEnd = source.indexOf("\n};", journalStart);
const sourceEnum = source.match(/^enum class HistorySource[^\n]+/m)?.[0];
assert.ok(journalStart >= 0 && journalEnd > journalStart && sourceEnum);
let restoreFixture = fixture.slice(0, fixture.indexOf("\nvoid runtime_boot("));
assert.ok(restoreFixture.endsWith('throw std::runtime_error(why); }'));
restoreFixture = '#include "logic/checkup_persist.hpp"\n' + restoreFixture;
const lockModel = String.raw`
int flash_depth=0, history_depth=0, owned_reads=0;
bool flash_contended=false;
void (*after_flash_release)()=nullptr;
void need(bool, const char*);
template<typename T> struct FlashOwned {
 T value{};
 operator T() const { need(flash_depth==1,"unguarded restore metadata read"); ++owned_reads; return value; }
 FlashOwned& operator=(T v) { need(flash_depth==1,"unguarded restore metadata write"); value=v; return *this; }
 FlashOwned& operator=(const FlashOwned& v) { return *this=static_cast<T>(v); }
 FlashOwned& operator++() { *this=static_cast<T>(*this)+1; return *this; }
 T operator++(int) { T old=*this; ++*this; return old; }
};
struct Lock {
 void* sem; bool held=false;
 explicit Lock(void* m):Lock(m,0) {}
 Lock(void* m,int):sem(m) {
  if(!m || (m==s_flash_mtx&&flash_contended))return;
  if(m==s_flash_mtx){need(history_depth==0,"history-to-flash lock inversion"); need(flash_depth==0,"recursive flash acquisition"); ++flash_depth;}
  else {need(history_depth==0,"recursive history acquisition"); ++history_depth;}
  held=true;
 }
 bool acquired() const{return held;}
 ~Lock() noexcept(false) {
  if(!held)return;
  if(sem==s_flash_mtx){--flash_depth;if(after_flash_release){auto next=after_flash_release;after_flash_release=nullptr;next();}}
  else --history_depth;
 }
};
`;
const oldLock = "struct Lock { explicit Lock(void*) {} bool acquired() const { return true; } };";
assert.equal(restoreFixture.split(oldLock).length,2);
restoreFixture = restoreFixture.replace(oldLock,"");
const beforeArrays = "int64_t s_flash_last_bucket[HISTORY_JOURNAL_SOURCE_COUNT];";
assert.equal(restoreFixture.split(beforeArrays).length,2);
restoreFixture = restoreFixture.replace(beforeArrays,lockModel+"\nFlashOwned<int64_t> s_flash_last_bucket[HISTORY_JOURNAL_SOURCE_COUNT];");
restoreFixture = restoreFixture.replace("int64_t s_flash_newest_bucket[", "FlashOwned<int64_t> s_flash_newest_bucket[")
  .replace("int64_t s_flash_oldest_bucket[", "FlashOwned<int64_t> s_flash_oldest_bucket[")
  .replace("uint16_t s_flash_restore_slot_count[", "FlashOwned<uint16_t> s_flash_restore_slot_count[");
restoreFixture += "\n" + sourceEnum + "\n" + source.slice(journalStart,journalEnd+3) + String.raw`
using CheckupFlashRecord=logic::CheckupJournalRecord;
enum class CheckupFlashRestoreResult:uint8_t {Deferred,Ignored,Restored};
using esp_err_t=int; constexpr int ESP_OK=0;
constexpr size_t kTotalRings=HISTORY_FLASH_TOTAL_RINGS,kRestoreRingsPerTick=4;
FlashOwned<bool> s_flash_scan_ok,s_flash_restore_done,s_flash_checkup_restore_done;
FlashOwned<size_t> s_flash_restore_ring,s_flash_restored_rings;
FlashOwned<uint16_t> s_flash_restore_slots[HISTORY_JOURNAL_SOURCE_COUNT][HISTORY_SAMPLES];
std::atomic<bool> s_reset_requested{false},s_mb_reset_requested{false},s_circulation_reset_requested{false};
std::atomic<uint32_t> s_circulation_fp{0};
bool s_persist_dirty=false;
struct ExistingStore {uint32_t circulation_fp=0;} existing_store;
ExistingStore& P(){return existing_store;}
alignas(8) unsigned char s_flash_sector[HISTORY_FLASH_ERASE_BYTES];
HistorySample s_flash_restore_blocks[4][HISTORY_SAMPLES],s_splice_live[HISTORY_SAMPLES],s_splice_out[HISTORY_SAMPLES];
FlashJournalRecord stored[4];
int flash_reads=0,checkup_calls=0; bool queue_reset=false;
void diag_printf(const char*,...){}
const char* esp_err_to_name(int){return "fixture";}
bool time_synced(){return true;}
void time_now(int64_t& sec,int32_t& ms){sec=300000;ms=0;}
void persist_seal_locked(){}
logic::TrendRing* ring_at(HistorySource src,size_t index){return src==HistorySource::Room&&index==0?&R().ring:nullptr;}
int64_t source_anchor_bucket_locked(HistorySource){return 1000;}
bool seed_source_timeline_locked(HistorySource,int64_t,int64_t&){throw std::runtime_error("unexpected seed");}
void deferred_reset(){history_room_reset(202);}
esp_err_t flash_read_record(size_t slot,FlashJournalRecord& out){
 need(flash_depth==1,"record selection without flash owner");++flash_reads;
 need(slot<4,"fixture slot bound");out=stored[slot];
 if(queue_reset){queue_reset=false;after_flash_release=deferred_reset;}
 return ESP_OK;
}
bool flash_record_valid(const FlashJournalRecord& r){
 need(flash_depth==1,"record validation without flash owner");
 return r.header.source==static_cast<uint8_t>(HistoryJournalSource::Checkup)||
        history_journal_room_header_matches(r.header,s_room_identity.load());
}
int flash_record_stored_index(const HistoryJournalHeader&,size_t index){return index==0?0:-1;}
void flash_note_restore_ahead(size_t,int64_t,int64_t){need(flash_depth==1,"restore note without owner");}
CheckupFlashRestoreResult checkup_flash_restore(const CheckupFlashRecord*,size_t n,int64_t){
 need(flash_depth==1,"checkup restore lost caller flash owner");need(n==1,"checkup record selection");
 ++checkup_calls;return CheckupFlashRestoreResult::Restored;
}
` + restoreFunctions + String.raw`
void prepare_restore(){
 need(flash_depth==0&&history_depth==0,"fixture leaked owner");
 flash_contended=false;after_flash_release=nullptr;queue_reset=false;flash_reads=checkup_calls=0;
 Lock flash(s_flash_mtx);room_wipe_locked(101);s_room_identity.store(101);
 s_flash_scan_ok=true;s_flash_restore_done=false;s_flash_checkup_restore_done=false;
 s_flash_restore_ring=kTotalRings-1;s_flash_restored_rings=0;
 for(size_t s=0;s<HISTORY_JOURNAL_SOURCE_COUNT;++s){
  s_flash_newest_bucket[s]=s_flash_oldest_bucket[s]=INT64_MIN;s_flash_restore_slot_count[s]=0;
 }
 const size_t room=static_cast<size_t>(HistoryJournalSource::Room),checkup=static_cast<size_t>(HistoryJournalSource::Checkup);
 s_flash_newest_bucket[room]=1000;s_flash_oldest_bucket[room]=999;s_flash_restore_slot_count[room]=2;
 s_flash_restore_slots[room][0]=1;s_flash_restore_slots[room][1]=2;
 s_flash_newest_bucket[checkup]=83;s_flash_oldest_bucket[checkup]=83;s_flash_restore_slot_count[checkup]=1;
 s_flash_restore_slots[checkup][0]=3;
 for(size_t slot=1;slot<=2;++slot){
  auto& h=stored[slot].header;h={};h.magic=HISTORY_JOURNAL_MAGIC;h.version=HISTORY_JOURNAL_VERSION;
  h.source=static_cast<uint8_t>(HistoryJournalSource::Room);h.flags=HISTORY_JOURNAL_FLAG_TARGET_SCOPED;
  h.catalog_fp=HISTORY_ROOM_SCHEMA;h.commit=HISTORY_JOURNAL_COMMITTED;h.value_count=1;
  h.slot_bytes=HISTORY_JOURNAL_SLOT_BYTES;h.sequence=slot;h.bucket=1001-static_cast<int64_t>(slot);
  h.dt_s=HISTORY_DT_S;h.rings[0]=h.rings[1]=h.rings[2]=1;history_journal_set_scope(h,101);
  const HistorySample reading=slot==1?240:236;std::memcpy(stored[slot].payload,&reading,sizeof(reading));
 }
 stored[3]={};stored[3].header.source=static_cast<uint8_t>(HistoryJournalSource::Checkup);stored[3].header.bucket=83;
}
void run_restore(){
 prepare_restore();history_service_flash_restore();
 need(flash_depth==0&&history_depth==0,"restore released all locks");
 need(flash_reads==3&&checkup_calls==1,"checkup and room scanned once without recursive flash acquisition");
 HistorySample value=0;need(R().ring.count==2,"actual source block restored");
 need(R().ring.sample_from_newest(0,value)&&value==240,"actual latest sample restored");
 need(R().ring.sample_from_newest(1,value)&&value==236,"actual older sample restored");

 prepare_restore();queue_reset=true;history_service_flash_restore();
 need(flash_depth==0&&history_depth==0,"concurrent reset releases all locks");
 need(R().identity==202&&R().ring.count==0,"queued actual source reset retires entire restored block");
 {Lock flash(s_flash_mtx);const size_t room=static_cast<size_t>(HistoryJournalSource::Room);
  need(s_flash_newest_bucket[room]==INT64_MIN&&s_flash_oldest_bucket[room]==INT64_MIN,"reset endpoints remain cleared");
  const HistorySample old=236;
  need(!history_splice_snapshot(HistorySource::Room,0,&old,1,1,1000,101),"final splice identity refuses predecessor");}

 prepare_restore();flash_contended=true;int before=owned_reads;
 history_service_flash_restore();
 need(owned_reads==before&&flash_reads==0&&checkup_calls==0,"nonblocking restore touches no owned metadata on contention");
 flash_contended=false;need(flash_depth==0&&history_depth==0,"contended restore owns nothing");
}
}
int main(){try{daik::run_restore();std::puts("production flash restore ownership passed");return 0;}
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
    ["missing-byte-wipe","std::memset(reinterpret_cast<unsigned char*>(&R()), 0, sizeof(R()));","(void)sizeof(R());"],
  ]) {
    assert.equal(fixture.split(before).length,2,`one mutation site ${name}`);
    const bad=run(fixture.replace(before,after),name);
    assert.notEqual(bad.status,0,`${name}: broken production path must fail`);
  }
  const restored=run(restoreFixture,"restore-base"); assert.equal(restored.status,0,restored.stderr);
  for(const [name,before,after] of [
    ["unguarded-restore-index",
      "    Lock flash_lk(s_flash_mtx, 0);\n    if (!flash_lk.acquired() || s_flash_forgotten.load() || !s_flash_scan_ok) return;",
      "    if (s_flash_forgotten.load() || !s_flash_scan_ok) return;"],
    ["recursive-checkup-flash",
      "static void history_restore_checkup_flash() {",
      "static void history_restore_checkup_flash() { Lock nested(s_flash_mtx,0); if(!nested.acquired())return;"],
  ]) {
    assert.equal(restoreFixture.split(before).length,2,`one restore mutation site ${name}`);
    const bad=run(restoreFixture.replace(before,after),name);
    assert.notEqual(bad.status,0,`${name}: broken production restore must fail`);
    assert.match(bad.stderr,name==="unguarded-restore-index" ? /unguarded restore metadata read/ : /recursive flash acquisition/);
  }
  console.log("room history: production record/reset/snapshot/adoption plus locked flash/checkup restore and reset interleaving; six negative controls passed");
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
