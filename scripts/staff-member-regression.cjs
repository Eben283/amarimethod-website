const fs=require('fs'), path=require('path'), assert=require('assert');
const repo=process.cwd();
const here=process.env.RUNNER_TEMP || __dirname, rt=process.env.STAFF_TEST_RUNTIME; if (!rt) throw Error('STAFF_TEST_RUNTIME required');
const esbuild=require(repo+'/node_modules/esbuild');
const React=require(rt+'/react'), {create,act}=require(rt+'/react-test-renderer');
process.env.TZ='Europe/Rome';
const results=[]; const H=global.__audit={api:{},params:{id:'A'}};
global.fetch=()=>{throw Error('Unexpected real network')};
global.document={body:{},visibilityState:'visible',addEventListener(){},removeEventListener(){}};
global.window={addEventListener(){},removeEventListener(){}};
const flush=()=>new Promise(r=>setImmediate(r));
const text=t=>JSON.stringify(t.toJSON());
const button=(t,s)=>t.root.findAllByType('button').find(b=>String(b.props.children).includes(s));
function deferred(){let resolve,reject;let promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function bundle(name,file,endpoint=false){
 const source=fs.readFileSync(file,'utf8');
 const imports=[...source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)];
 const names=new Map(imports.map(m=>[m[2],m[1]]));
 await esbuild.build({entryPoints:[file],bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(here,name+'.cjs'),plugins:[{name:'isolate',setup(b){
 b.onResolve({filter:/.*/},a=>{
 if(a.kind==='entry-point')return;
 if(a.path==='react'||a.path.startsWith('react/'))return {path:require.resolve(a.path,{paths:[rt]}),external:true};
 if(a.path.includes('moduleStorage'))return {path:repo+'/staff/src/data/moduleStorage.ts'};
 if(a.path.includes('useApiCall'))return {path:repo+'/staff/src/hooks/useApiCall.ts'};
 if(a.path.endsWith('.css'))return {path:a.path,namespace:'empty'};
 return {path:a.path,namespace:'mock'};
 });
 b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>{
 if(a.path==='react-dom')return {contents:'export const createPortal=x=>x;'};
 if(a.path==='react-router-dom')return {contents:'export const useParams=()=>global.__audit.params;export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams()];export const Link=()=>null;export const NavLink=()=>null;const location={pathname:"/communications",state:null};export const useLocation=()=>location;'};
 if(a.path.includes('AuthContext'))return {contents:'const logout=()=>{};export const useAuth=()=>({logout});'};
 if(a.path.endsWith('/api')) return {contents:`export class ApiError extends Error {constructor(message,status){super(message);this.status=status}};`+[...(source.match(/import \{[^;]+from ['"]\.\.\/lib\/api['"]/s)||[''])[0].matchAll(/\b(get\w+|saveProgress|markAttended|send\w+|searchContacts)\b/g)].map(m=>m[1]).filter((v,i,arr)=>arr.indexOf(v)===i).map(n=>`export const ${n}=(...a)=>global.__audit.api.${n}(...a);`).join('\n')};
 const spec=names.get(a.path)||'';const members=(spec.match(/\{([\s\S]*?)\}/)||[])[1]||'';
 let ns=members.split(',').map(v=>v.trim()).filter(v=>v&&!v.startsWith('type ')).map(v=>v.split(/\s+as\s+/).pop());
 if(a.path.includes('endpoint-guards'))ns=['requireStaffAuth','corsHeaders'];
 if(a.path.endsWith('/ghl.js'))ns=['ghlHeaders','getGhlToken'];
 let out='export default ()=>null;\n'+ns.map(n=>`export const ${n}=(...a)=>global.__audit.mock?.['${n}']?.(...a)??null;`).join('\n');
 if(a.path.includes('ghl-fields'))out='export const FIELD_IDS={};';
 return {contents:out};
 });
 }}]});return require(path.join(here,name+'.cjs'));
}
(async()=>{
// Actual current ClientDetailPage mounted, dependencies reduced to read-only synthetic responses.
H.mock={buildSessionBrief:()=>'',selectCurrentVisit:()=>null,visitLabel:()=>'',clientDeskContactPath:()=>'',memberWorkspacePath:()=>''};
let t; let waits={};H.api={getContactDetail:id=>(waits[id]=deferred()).promise,getOwedStatus:async()=>null};
const Detail=(await bundle('detail',repo+'/staff/src/pages/ClientDetailPage.tsx')).default;
const person=id=>({id,firstName:'Synthetic'+id,lastName:'',tags:[],appointments:[],notes:[],customFields:[],sessionsRemaining:0,sessionsCompleted:0,seriesType:'none',purchases:[],messages:[]});
H.params={id:'A'};await act(async()=>{t=create(React.createElement(Detail,{surface:'session'}));await flush()});
H.params={id:'B'};await act(async()=>{t.update(React.createElement(Detail,{surface:'session'}));await flush()});
await act(async()=>{waits.B.resolve(person('B'));await flush()});assert(text(t).includes('SyntheticB'));results.push({case:'member_B_response_positive_control',rendered:'B'});
await act(async()=>{waits.A.resolve(person('A'));await flush()});assert(text(t).includes('SyntheticB'), 'Late A response must not replace selected B'); assert(!text(t).includes('SyntheticA')); results.push({case:'member_old_response_ignored',route:H.params.id,rendered:'B'});await act(async()=>t.unmount());
H.params={id:'A'}; await act(async()=>{t=create(React.createElement(Detail,{surface:'session'}));await flush()});
await act(async()=>{waits.A.resolve(person('A'));await flush()});assert(text(t).includes('SyntheticA'));
H.params={id:'B'};await act(async()=>{t.update(React.createElement(Detail,{surface:'session'}));await flush()});
assert(!text(t).includes('SyntheticA'),'Previous member must disappear while selected member loads');
await act(async()=>{waits.B.reject(new Error('Synthetic B unavailable'));await flush()});
assert(text(t).includes('Synthetic B unavailable'),'Selected member load error must be visible');assert(!text(t).includes('SyntheticA'));
results.push({case:'selected_member_failure_does_not_retain_previous',passed:true});await act(async()=>t.unmount());

const focusListeners=new Set();window.addEventListener=(type,fn)=>{if(type==='focus')focusListeners.add(fn)};window.removeEventListener=(type,fn)=>{if(type==='focus')focusListeners.delete(fn)};
H.params={id:'A'};await act(async()=>{t=create(React.createElement(Detail,{surface:'session'}));await flush()});await act(async()=>{waits.A.resolve(person('A'));await flush()});
await act(async()=>{for(const fn of focusListeners)fn();await flush()});const olderReload=waits.A;
await act(async()=>{for(const fn of focusListeners)fn();await flush()});const newerReload=waits.A;assert.notStrictEqual(olderReload,newerReload);
await act(async()=>{newerReload.resolve({...person('A'),firstName:'FreshMemberRead'});await flush()});assert(text(t).includes('FreshMemberRead'));
await act(async()=>{olderReload.resolve({...person('A'),firstName:'StaleMemberRead'});await flush()});assert(text(t).includes('FreshMemberRead'),'Old same-member refresh must not replace latest data');assert(!text(t).includes('StaleMemberRead'));
results.push({case:'same_member_reload_response_order',passed:true});await act(async()=>t.unmount());
const realSetTimeout=global.setTimeout,realClearTimeout=global.clearTimeout;const saveTimers=new Map();let saveTimerId=0;const memberSaves=[];
global.setTimeout=(fn,ms)=>{const key=++saveTimerId;saveTimers.set(key,{fn,ms});return key};global.clearTimeout=key=>saveTimers.delete(key);
H.api.saveProgress=async(id,value)=>{memberSaves.push({id,value});return {success:true}};
H.params={id:'A'};await act(async()=>{t=create(React.createElement(Detail,{surface:'session'}));await flush()});await act(async()=>{waits.A.resolve(person('A'));await flush()});
const moduleButton=t.root.findAllByType('button').find(b=>typeof b.props.className==='string'&&/^sa-mod(?: |$)/.test(b.props.className));assert(moduleButton,'Protocol control rendered');
await act(async()=>moduleButton.props.onClick());assert([...saveTimers.values()].some(x=>x.ms===800));
H.params={id:'B'};await act(async()=>{t.update(React.createElement(Detail,{surface:'session'}));await flush()});
await act(async()=>{for(const [key,x]of [...saveTimers]){if(x.ms===800){saveTimers.delete(key);x.fn()}}await flush()});
assert.equal(memberSaves.length,1,'Navigation must not cancel accepted member progress edit');assert.equal(memberSaves[0].id,'A','Pending progress remains owned by originating member');assert.equal(memberSaves[0].value.modules['suspension-squat'],true);
results.push({case:'pending_progress_survives_member_switch',savedFor:'A'});await act(async()=>t.unmount());global.setTimeout=realSetTimeout;global.clearTimeout=realClearTimeout;

console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
