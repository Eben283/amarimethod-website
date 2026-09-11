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
let t;let closed=0;let writes=[];let saveReply=deferred();
H.api={getContactDetail:async()=>({clientProgress:null}),saveProgress:(id,value)=>{writes.push({id,value});return saveReply.promise}};
const Sheet=(await bundle('session-regression',repo+'/staff/src/components/SessionDocSheet.tsx')).default;
const mount=async()=>{closed=0;await act(async()=>{t=create(React.createElement(Sheet,{contactId:'A',clientName:'Synthetic A',onClose(){closed++}}));await flush()})};
const oldSet=global.setTimeout,oldClear=global.clearTimeout;let clockId=0;const pendingTimers=new Map();global.setTimeout=(fn,ms)=>{pendingTimers.set(++clockId,{fn,ms});return clockId};global.clearTimeout=id=>pendingTimers.delete(id);
await mount();await act(async()=>button(t,'Suspension Squat').props.onClick());
await act(async()=>{t.root.findByProps({'aria-label':'Close'}).props.onClick();await flush()});
assert.equal(writes.length,1,'Close must dispatch pending edit immediately');assert.equal(closed,0,'Must wait for save before closing');
await act(async()=>{saveReply.resolve({success:true});await flush()});assert.equal(closed,1);assert.equal(writes[0].id,'A');assert.equal(writes[0].value.modules['suspension-squat'],true);await act(async()=>t.unmount());results.push({case:'close_flushes_and_waits',passed:true});
H.api.saveProgress=async()=>{throw Error('Synthetic failure')};await mount();await act(async()=>button(t,'Suspension Squat').props.onClick());await act(async()=>{t.root.findByProps({'aria-label':'Close'}).props.onClick();await flush()});assert.equal(closed,0);assert(text(t).includes('Not saved'));assert(text(t).includes('Changes have not been saved'));assert(button(t,'Suspension Squat').props.className.includes('bg-amari-charcoal'));
H.api.saveProgress=async()=>({success:true});await act(async()=>{button(t,'Retry saving').props.onClick();await flush()});assert(text(t).includes('Saved'));await act(async()=>{t.root.findByProps({'aria-label':'Close'}).props.onClick();await flush()});assert.equal(closed,1);await act(async()=>t.unmount());results.push({case:'failed_close_retains_input_and_retry_recovers',passed:true});
writes=[];H.api.saveProgress=async(id,value)=>{writes.push({id,value});return {success:true}};await mount();await act(async()=>button(t,'Suspension Squat').props.onClick());assert.equal(writes.length,0);await act(async()=>{t.unmount();await flush()});assert.equal(writes.length,1);assert.equal(writes[0].id,'A');results.push({case:'unmount_dispatches_pending_progress',passed:true});
const writeReplies=[];writes=[];H.api.saveProgress=(id,value)=>{const reply=deferred();writeReplies.push(reply);writes.push({id,value});return reply.promise};
await mount();await act(async()=>button(t,'Suspension Squat').props.onClick());
await act(async()=>{for(const [id,x]of [...pendingTimers])if(x.ms===800){pendingTimers.delete(id);x.fn()}await flush()});assert.equal(writes.length,1);
await act(async()=>button(t,'Hand Balancer').props.onClick());await act(async()=>{t.root.findByProps({'aria-label':'Close'}).props.onClick();await flush()});assert.equal(writes.length,1,'New snapshot must wait for older write');assert.equal(closed,0);
await act(async()=>{writeReplies[0].resolve({success:true});await flush()});assert.equal(writes.length,2);assert.equal(writes[1].value.modules['suspension-squat'],true);assert.equal(writes[1].value.modules['hand-balancer'],true);assert.equal(closed,0);
await act(async()=>{writeReplies[1].resolve({success:true});await flush()});assert.equal(closed,1);await act(async()=>t.unmount());results.push({case:'progress_snapshots_serialize_and_latest_edit_wins',passed:true});
global.setTimeout=oldSet;global.clearTimeout=oldClear;
console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
