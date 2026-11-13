'use strict';
// Decimal 10 GB is Cloudflare R2's free storage allowance per billing month.
// Reserve 200 MB for state, metadata, rounding, and temporary orphan cleanup.
const ARCHIVE_FREE_CAP_BYTES = 9_800_000_000;
function usedBytes(items){return (items||[]).reduce((sum,item)=>sum+(Number(item.size)||0),0)}
function hasRoom(items, incomingBytes, limit=ARCHIVE_FREE_CAP_BYTES){
  return Number.isSafeInteger(incomingBytes)&&incomingBytes>=0&&usedBytes(items)+incomingBytes<=limit
}
function formatStorageStatus(items,limit=ARCHIVE_FREE_CAP_BYTES){
  const used=usedBytes(items);
  return {capBytes:limit,usedBytes:used,remainingBytes:Math.max(0,limit-used),full:used>=limit}
}
function isExactDuplicate(items, sha){return !!sha&&items.some(item=>item.sha===sha)}
function archiveCompletion({pendingCategories,unresolved,storageFull,connected}){
 if(!connected)return 'storage_unconfigured';
 if(storageFull)return 'storage_full';
 if(unresolved>0)return 'incomplete_errors';
 if(pendingCategories>0)return 'collecting';
 return 'source_scan_complete';
}
module.exports={ARCHIVE_FREE_CAP_BYTES,usedBytes,hasRoom,formatStorageStatus,isExactDuplicate,archiveCompletion};
