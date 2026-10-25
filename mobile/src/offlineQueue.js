import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const dbTask=SQLite.openDatabaseAsync('yard-sync.db');
async function db(){const d=await dbTask;await d.execAsync(`CREATE TABLE IF NOT EXISTS pending_actions(
 id TEXT PRIMARY KEY,path TEXT NOT NULL,body TEXT NOT NULL,idempotency_key TEXT NOT NULL,user_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',response TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);const columns=await d.getAllAsync('PRAGMA table_info(pending_actions)');if(!columns.some(x=>x.name==='user_id'))await d.execAsync('ALTER TABLE pending_actions ADD COLUMN user_id INTEGER NOT NULL DEFAULT -1');await d.runAsync("UPDATE pending_actions SET status='pending' WHERE status='syncing' AND user_id=?",[await currentUserId()]);return d;}
async function currentUserId(){const raw=await AsyncStorage.getItem('yard_user');return raw?Number(JSON.parse(raw).id):-1;}
export function newId(){return `yard-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;}
export async function enqueue(path,body,key=newId()){
 const d=await db();await d.runAsync('INSERT OR IGNORE INTO pending_actions(id,path,body,idempotency_key,user_id,status) VALUES(?,?,?,?,?,?)',[key,path,JSON.stringify(body),key,await currentUserId(),'pending']);
 return {queued:true,id:key};
}
export async function listQueued(){const d=await db();return d.getAllAsync('SELECT * FROM pending_actions WHERE user_id=? ORDER BY created_at DESC,id DESC',[await currentUserId()]);}
export async function clearConfirmed(){const d=await db();await d.runAsync("DELETE FROM pending_actions WHERE user_id=? AND status='confirmed'",[await currentUserId()]);}
export async function removeFailed(id){const d=await db();await d.runAsync("DELETE FROM pending_actions WHERE id=? AND user_id=? AND status='failed'",[id,await currentUserId()]);}
export async function syncQueued(){
 const d=await db();const rows=await d.getAllAsync("SELECT * FROM pending_actions WHERE user_id=? AND status IN ('pending','failed') ORDER BY created_at,id",[await currentUserId()]);
 for(const row of rows){
  await d.runAsync("UPDATE pending_actions SET status='syncing',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[row.id]);
  try{const {data}=await api.post(row.path,JSON.parse(row.body),{headers:{'Idempotency-Key':row.idempotency_key}});await d.runAsync("UPDATE pending_actions SET status='confirmed',response=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(data),row.id]);}
  catch(e){const status=e.response?.status;const message=e.response?.data?.error||e.message||'Sync failed';const pending=!e.response||status>=500||(status===409&&message.toLowerCase().includes('still processing'));await d.runAsync("UPDATE pending_actions SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[pending?'pending':'failed',message,row.id]);}
 }
 return listQueued();
}
export async function queueAction(path,body){
 const key=newId();
 try{return {data:(await api.post(path,body,{headers:{'Idempotency-Key':key}})).data};}
 catch(e){if(e.response)return Promise.reject(e);return enqueue(path,body,key);}
}
