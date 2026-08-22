import{j as e,u as z}from"./QuizApp.MCQhh4Th.js";import"./index.BXmx4ITx.js";const O=({patternSignature:t})=>e.jsxs("section",{className:"hero-finding doc-narrow",children:[e.jsxs("span",{className:"hero-stamp",children:[e.jsx("span",{className:"glyph",children:"§"}),e.jsx("span",{children:t})]}),e.jsxs("h1",{className:"hero-headline",children:["Your body is working around something.",e.jsx("br",{}),"It may not need to keep working that way."]}),e.jsx("p",{className:"hero-sub",children:"This is a starting read, not a diagnosis. The Assessment is where Garrett can see what is actually present and guide the work with you."}),e.jsx("div",{className:"hero-meta",children:e.jsxs("div",{className:"cell",children:[e.jsx("span",{className:"lbl",children:"Primary observation"}),e.jsx("span",{className:"val",children:t})]})})]}),d={ink:"#1F1D1A",ink2:"#3A3733",mute:"#7A746B",line:"#E0D7C2",accent:"#C56B4E"},i={card:{padding:0,display:"flex",flexDirection:"column",gap:12},head:{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:14},title:{fontFamily:"var(--sans)",fontSize:20,fontWeight:300,letterSpacing:"-0.02em",lineHeight:1.15,color:d.ink},titleCompact:{fontFamily:"var(--sans)",fontSize:16,fontWeight:300,letterSpacing:"-0.015em",color:d.ink},subtitle:{fontFamily:"var(--sans)",fontSize:10,letterSpacing:"0.22em",textTransform:"uppercase",color:d.mute,marginTop:4},scoreNum:{fontFamily:"var(--sans)",fontSize:36,fontWeight:300,fontStyle:"normal",color:d.ink,lineHeight:1},scoreNumCompact:{fontFamily:"var(--sans)",fontSize:24,fontWeight:300,fontStyle:"normal",color:d.ink,lineHeight:1},bar:{height:2,width:"100%",background:d.line,overflow:"hidden",margin:"6px 0 10px"},barFill:{height:"100%",background:d.accent,transition:"width 700ms ease-out"},category:{fontFamily:"var(--sans)",fontSize:10,letterSpacing:"0.24em",textTransform:"uppercase",color:d.accent},desc:{fontFamily:"var(--sans)",fontSize:14,lineHeight:1.55,color:d.ink2}},m=({title:t,subtitle:r,score:a,description:n,compact:o=!1})=>{let s="";return a<25?s="Minimal":a<50?s="Mild":a<75?s="Moderate":s="Significant",o?e.jsxs("div",{style:i.card,children:[e.jsxs("div",{style:i.head,children:[e.jsx("span",{style:i.titleCompact,children:t}),e.jsxs("span",{style:i.scoreNumCompact,children:[a,"%"]})]}),e.jsx("div",{style:i.bar,children:e.jsx("div",{style:{...i.barFill,width:`${a}%`}})}),e.jsx("span",{style:i.category,children:s}),e.jsx("p",{style:i.desc,children:n})]}):e.jsxs("div",{style:i.card,children:[e.jsxs("div",{style:i.head,children:[e.jsxs("div",{children:[e.jsx("h3",{style:i.title,children:t}),r?e.jsx("p",{style:i.subtitle,children:r}):null]}),e.jsxs("span",{style:i.scoreNum,children:[a,"%"]})]}),e.jsx("div",{style:i.bar,children:e.jsx("div",{style:{...i.barFill,width:`${a}%`}})}),e.jsx("span",{style:i.category,children:s}),e.jsx("p",{style:i.desc,children:n})]})},p=[{key:"softTissueTension",label:"Protective tension"},{key:"jointBoneAlignment",label:"Structural adaptation"},{key:"patternDuration",label:"Time present"},{key:"dailyActivitiesImpact",label:"Daily life"},{key:"bodyAdaptations",label:"Compensatory movement"}],y=150,u=92,g=(t,r)=>{const a=(-90+r*(360/p.length))*(Math.PI/180);return{x:y+Math.cos(a)*t,y:y+Math.sin(a)*t}},L=t=>p.map((r,a)=>{const{x:n,y:o}=g(t,a);return`${n},${o}`}).join(" "),F=({scores:t})=>{const r=p.map(({key:a},n)=>{const{x:o,y:s}=g(Math.max(16,t[a]/100*u),n);return`${o},${s}`}).join(" ");return e.jsxs("section",{className:"response-profile","aria-labelledby":"response-profile-heading",children:[e.jsxs("div",{className:"section-head",style:{paddingTop:0},children:[e.jsx("span",{className:"eyebrow",children:"Answer map"}),e.jsx("h2",{id:"response-profile-heading",children:"The themes in your answers."}),e.jsx("p",{className:"lede",children:"A visual starting point for the Assessment—not a diagnosis."})]}),e.jsxs("div",{className:"response-map-grid",children:[e.jsx("div",{className:"response-map","aria-label":"Answer theme map",children:e.jsxs("svg",{viewBox:"0 0 300 300",role:"img","aria-labelledby":"response-map-title response-map-description",children:[e.jsx("title",{id:"response-map-title",children:"Answer theme map"}),e.jsx("desc",{id:"response-map-description",children:"A five-part visual summary of themes from your quiz answers."}),[.38,.69,1].map(a=>e.jsx("polygon",{points:L(u*a),className:"response-map-gridline"},a)),p.map((a,n)=>{const o=g(u,n);return e.jsx("line",{x1:y,y1:y,x2:o.x,y2:o.y,className:"response-map-axis"},n)}),e.jsx("polygon",{points:r,className:"response-map-shape"}),p.map(({key:a},n)=>{const o=t[a],{x:s,y:l}=g(Math.max(16,o/100*u),n);return e.jsx("circle",{cx:s,cy:l,r:"4.5",className:"response-map-point"},a)})]})}),e.jsx("div",{className:"response-map-key",children:p.map(({key:a,label:n})=>e.jsxs("div",{className:"response-map-key-row",children:[e.jsx("span",{className:"response-map-key-dot","aria-hidden":"true"}),e.jsx("span",{children:n})]},a))})]})]})},c={wrap:{padding:"0"},list:{display:"flex",flexDirection:"column",gap:0,borderTop:"1px solid #E0D7C2"},row:{display:"grid",gridTemplateColumns:"auto 1fr",gap:24,alignItems:"baseline",padding:"24px 0",borderBottom:"1px solid #E0D7C2"},num:{fontFamily:"var(--sans)",fontSize:11,letterSpacing:"0.24em",color:"#C56B4E",textTransform:"uppercase"},body:{display:"flex",flexDirection:"column",gap:8},title:{fontFamily:"var(--sans)",fontSize:22,fontWeight:300,letterSpacing:"-0.02em",lineHeight:1.2,color:"#1F1D1A"},desc:{fontFamily:"var(--sans)",fontSize:15,lineHeight:1.6,color:"#3A3733"}},B=({insights:t})=>e.jsxs("div",{style:c.wrap,children:[e.jsxs("div",{className:"section-head",style:{paddingTop:0},children:[e.jsx("span",{className:"eyebrow",children:"Personalised insights"}),e.jsx("h2",{children:"What we read in your answers."}),e.jsx("p",{className:"lede",children:"Patterns specific to the way you answered."})]}),e.jsx("div",{style:c.list,children:t.map((r,a)=>e.jsxs("div",{style:c.row,children:[e.jsx("span",{style:c.num,children:String(a+1).padStart(2,"0")}),e.jsxs("div",{style:c.body,children:[e.jsx("h3",{style:c.title,children:r.title}),e.jsx("p",{style:c.desc,children:r.description})]})]},a))})]}),H={displayName:"Lower Back Pain",conditionPageSlug:"lower-back-pain-san-francisco",whyHeading:"Why your lower back keeps hurting",whySubline:"The back is where the pain lives. But it's rarely where the problem starts.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"Your lower back is absorbing force that should be distributed across your pelvis and hips. When parts of your body stop doing their job, other parts overwork to compensate. That overwork becomes tightness, compression, and eventually pain."},{num:"02",title:"Why stretching and strengthening haven't worked",body:"If the areas creating the problem are still out of balance, strengthening and stretching can actually reinforce the pattern. You end up with a stronger version of the same compensation. The pain keeps coming back because the root cause hasn't changed."},{num:"03",title:"Why temporary relief stays temporary",body:"Adjustments, injections, and massage can provide real relief. But if nothing changes the mechanical pattern loading your spine, the relief fades. The Amari Method finds both ends of the problem at once: what's overworking releases, what's underworking re-engages."}],chainHeading:"Where lower back pain actually comes from",chainSubline:"The lumbar spine is the endpoint of forces traveling up from the pelvis and hips.",chainSteps:[{num:"01",flow:"PELVIS → POSITION",title:"Your pelvis is out of position.",body:"When the pelvis tips forward, the lower back is forced into compression with every step you take and every moment you stand. This is the most common pattern Garrett sees in people with chronic lower back pain. It's correctable, usually within the first few sessions."},{num:"02",flow:"HIPS → OFFLINE",title:"Parts of your hips have stopped working.",body:"Sitting for hours changes the balance between the front and back of your hips. The front gets tight and overactive. The back stops engaging. Your lower back muscles take over as the primary movers, and they're not built for that job."},{num:"03",flow:"PATTERN → PAIN",title:"Your spine is compensating for everything below it.",body:"Whether your pain is from a disc issue, SI joint dysfunction, sciatica, or general tightness, the pattern driving it is identifiable. Garrett assesses how force moves through your pelvis and spine and finds the specific imbalance creating your symptoms."}]},R={displayName:"Neck Pain",conditionPageSlug:"neck-pain-san-francisco",whyHeading:"Why your neck keeps hurting",whySubline:"The neck is where the pain shows up. But it's rarely where the problem starts.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"Your neck muscles are working overtime to hold your head in position because something below them has shifted. For every inch your head sits in front of your shoulders, it adds roughly ten pounds of load on your neck. Most people are two to three inches forward."},{num:"02",title:"Why stretching and massage haven't lasted",body:"Releasing the tight muscles in your neck and upper traps feels good in the moment. But those muscles are tight because they're overworking. If you don't change what they're overworking for, they tighten right back up."},{num:"03",title:"Why temporary relief stays temporary",body:"Adjustments, injections, and hands-on work can provide real relief. But if the postural pattern pulling your head forward hasn't changed, the load comes right back. The Amari Method finds both ends of the problem at once."}],chainHeading:"Where neck pain actually comes from",chainSubline:"The cervical spine is the endpoint of forces traveling up from the thoracic spine, ribcage, and shoulder blades.",chainSteps:[{num:"01",flow:"MID-BACK → STIFF",title:"Your mid-back has stiffened up.",body:"When the thoracic spine rounds and locks, the body compensates by extending through the neck. That pushes the head forward and compresses the cervical joints. Releasing thoracic mobility is often the fastest path to lasting neck relief."},{num:"02",flow:"SHOULDER BLADES → OFF POSITION",title:"Your shoulder blades have lost their position.",body:"The muscles that anchor your shoulder blades attach directly to your cervical spine. When the shoulder blades collapse forward, those muscles pull on the neck and the upper traps take over to stabilize your head."},{num:"03",flow:"UPPER BACK → OFFLINE",title:"Parts of your upper back have stopped working.",body:"Sitting at a desk, driving, or working with your arms in front of you for years changes the balance between the front and back of your shoulders. The front gets tight and dominant. The back stops engaging."},{num:"04",flow:"PATTERN → PAIN",title:"Your specific pattern is identifiable.",body:"Whether your pain is from disc compression, cervicogenic headaches, thoracic outlet syndrome, or general stiffness, the pattern driving it can be found."}]},k={displayName:"Shoulder Pain",conditionPageSlug:"shoulder-pain-san-francisco",whyHeading:"Why your shoulder keeps hurting",whySubline:"The shoulder is where the pain lives. But it's rarely where the problem starts.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"Your shoulder joint is taking on stress that should be distributed across your shoulder blade and upper back. When the muscles that stabilize your shoulder blade stop doing their job, other muscles overwork to pick up the slack. That overwork becomes impingement, tightness, and eventually pain."},{num:"02",title:"Why rotator cuff strengthening hasn't worked",body:"If the shoulder blade is still out of position, strengthening the rotator cuff can actually make things worse. You're building strength into a pattern that's already compromised. The pain keeps coming back because the foundation underneath the shoulder joint hasn't changed."},{num:"03",title:"Why temporary relief stays temporary",body:"Injections, massage, and manual therapy can provide real relief. But if nothing changes the positioning problem loading your shoulder, the relief fades."}],chainHeading:"Where shoulder pain actually comes from",chainSubline:"The shoulder joint is the endpoint of forces traveling up from the upper back and shoulder blade.",chainSteps:[{num:"01",flow:"SHOULDER BLADE → POSITION",title:"Your shoulder blade is out of position.",body:"When the shoulder blade tips forward and down, it narrows the space where your rotator cuff tendons live. Every time you raise your arm, those tendons get pinched. This is the most common pattern Garrett sees in people with chronic shoulder pain."},{num:"02",flow:"UPPER BACK → OFFLINE",title:"Parts of your upper back have stopped working.",body:"Sitting, driving, and phone use change the balance between the front and back of your upper body. The chest gets tight and overactive. The muscles between your shoulder blades stop engaging."},{num:"03",flow:"THORACIC → STIFF",title:"Your upper back isn't moving the way it should.",body:"A stiff thoracic spine forces the shoulders forward. Before any shoulder work can hold, the upper back needs to move freely. This is a step most shoulder treatments skip entirely."},{num:"04",flow:"PATTERN → PAIN",title:"Your individual pattern is identifiable.",body:"Whether your pain is from impingement, a rotator cuff issue, frozen shoulder, or general tightness, the pattern driving it is identifiable."}]},j={displayName:"Hip Pain",conditionPageSlug:"hip-pain-san-francisco",whyHeading:"Why your hip pain keeps coming back",whySubline:"The hip is where the pain shows up. But the problem almost always starts somewhere else.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"Your hip is being compressed because the structures around it are out of balance. When parts of your body stop doing their job, your hip joint absorbs forces it was never designed to handle alone. Tightness, pinching, and restricted movement are symptoms of that overload."},{num:"02",title:"Why stretching and strengthening haven't worked",body:"If the areas creating the problem are still out of balance, stretching tight hip flexors or strengthening your glutes can reinforce the same pattern. You get temporarily looser or stronger, but the hip is still being loaded the same way."},{num:"03",title:"Why temporary relief stays temporary",body:"Injections, manual therapy, and rest can provide real relief. But if nothing changes the mechanical pattern compressing your hip, the relief fades."}],chainHeading:"Where hip pain actually comes from",chainSubline:"The hip joint is a pressure junction. What surrounds it determines how it moves.",chainSteps:[{num:"01",flow:"PELVIS → POSITION",title:"Your pelvis is out of position.",body:"When the pelvis tips forward, it compresses the front of the hip joint. This is the single most common pattern Garrett sees in people with chronic hip pain. It's behind most diagnoses of impingement, labral irritation, hip flexor strain, and groin tightness."},{num:"02",flow:"HIPS → OFFLINE",title:"Parts of your hips have stopped working.",body:`Sitting for hours changes the balance between the front and back of your hips. The front gets tight and overactive. The back stops engaging. The hip joint loses its primary stabilizers and other structures take over. That's where the pinching and the feeling that your hip "catches" comes from.`},{num:"03",flow:"SUPPORT → OVERLOADED",title:"The structures taking over are getting overloaded.",body:"The IT band, piriformis, and hip flexors are often blamed for pain, but they're rarely the original cause. They become overworked because the primary hip mechanics aren't functioning. Releasing them directly without addressing the underlying pattern provides only temporary relief."},{num:"04",flow:"PATTERN → PAIN",title:"Your pattern is specific to you.",body:"Hip pain presents differently in every person. Garrett assesses your individual pelvic position, how your hip moves under load, and which structures are overworking and which have shut down."}]},T={displayName:"Knee Pain",conditionPageSlug:"knee-pain-san-francisco",whyHeading:"Why your knee keeps hurting",whySubline:"The knee is where the pain lives. But it's almost never where the problem starts.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"Your knee is a hinge. It does what the hip above it and the foot below it tell it to do. When parts of your hip stop doing their job, the knee starts absorbing rotational forces it wasn't built for. That shows up as pain around the kneecap, along the outside of the knee, or deep inside the joint."},{num:"02",title:"Why strengthening your quads hasn't worked",body:"The standard approach to knee pain is quad strengthening. But if your hip isn't controlling how your thigh bone rotates, you're just loading a misaligned joint harder. You end up with stronger legs and the same faulty mechanics."},{num:"03",title:"Why braces and injections don't last",body:"Braces redirect force temporarily. Cortisone reduces inflammation temporarily. Neither one changes the movement pattern that's overloading your knee in the first place. When the brace comes off or the injection wears off, the same forces return."}],chainHeading:"Where knee pain actually comes from",chainSubline:"The knee is a transmission point. What's above it determines how it moves.",chainSteps:[{num:"01",flow:"HIP → CONTROL",title:"Your hip isn't controlling your thigh bone.",body:"When the muscles on the side and back of your hip aren't doing their job, your thigh bone rotates inward with every step. That inward rotation pulls the kneecap off its natural track and creates stress on structures that weren't designed for that load."},{num:"02",flow:"IT BAND → OVERWORKING",title:"Your IT band is overworking.",body:"The IT band runs from the hip to just below the knee. When the hip isn't stable, the IT band picks up the slack. It tightens, creates friction on the outside of the knee, and becomes painful. Foam rolling feels good temporarily, but it doesn't change why the IT band is tight."},{num:"03",flow:"PATTERN → PAIN",title:"Your knee is absorbing forces meant for other structures.",body:"Whether your pain is patellofemoral, IT band syndrome, meniscus irritation, or general achiness that gets worse with stairs and running, the pattern behind it is identifiable."}]},D={elbows:"elbow pain","wrists-hands":"wrist or hand pain","ankles-feet":"ankle or foot pain","upper-back":"upper back pain"},Y=(t,r)=>({displayName:t,conditionPageSlug:null,whyHeading:`Why your ${D[r]??`${t.toLowerCase()} pain`} keeps coming back`,whySubline:"The pain is where you feel it. The problem is rarely where it starts.",whyCards:[{num:"01",title:"The pattern nobody has explained to you",body:"When parts of your body stop doing their job, other parts overwork to compensate. That overwork becomes tightness, compression, and eventually pain. Most treatments address the spot that hurts without asking why it's under so much load in the first place."},{num:"02",title:"Why stretching and strengthening haven't worked",body:"If the areas creating the problem are still out of balance, stretching and strengthening can reinforce the same pattern. The pain keeps coming back because the root cause hasn't changed."},{num:"03",title:"Why temporary relief stays temporary",body:"Manual therapy, injections, and adjustments can provide real relief. But if nothing changes the mechanical pattern, the relief fades. The Amari Method finds both ends of the problem: what's overworking releases, what's underworking re-engages."}],chainHeading:"Where pain like yours actually comes from",chainSubline:"Pain is the endpoint of forces moving through your body. The chain that produces it is identifiable.",chainSteps:[{num:"01",flow:"BALANCE → SHIFTED",title:"Your body is out of balance.",body:"Something is working too hard because something else stopped doing its job. Until that balance is restored, the overworking part stays under load."},{num:"02",flow:"COMPENSATION → LOAD",title:"The structures taking over are getting overloaded.",body:"Whatever is compensating for the underworking part is bearing forces it wasn't designed for. That's where the chronic tightness, fatigue, and pain comes from."},{num:"03",flow:"PATTERN → PAIN",title:"Your pattern is identifiable.",body:"Garrett assesses how force moves through your whole body, beyond the area that hurts, and finds the specific imbalance creating your symptoms."}]}),x={name:"The Spinal Wave",framingLine:'"Go for the feeling of it, not the doing of it. Let the ocean move you."',introVideoUrl:"https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30c3bfe4d0d3ac8d60938.mp4",posterImageUrl:"/images/photos/journal-base/jh-spinal-wave.jpg",durationLabel:"4 min"},f={name:"Power Posture",framingLine:'"We have a huge over-flexion problem in the culture, and this exercise totally corrects it."',introVideoUrl:"https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30d0ef5a3893acea59684.mp4",posterImageUrl:"/images/photos/journal-base/base-power-posture-1.5s.jpg",durationLabel:"2 min"},v={name:"Spring Step",framingLine:'"Imagine feeling the bottom of your body as buoyant and free, rather than stuck."',introVideoUrl:"https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c306b5f5a389ab2aa4c3a0.mp4",posterImageUrl:"/images/photos/journal-base/jh-spring-step.jpg",durationLabel:"3 min"},M={name:"The Hand Balancer",framingLine:'"Most people are experiencing some kind of hand issue these days. This balances out the hand so the front and back are working equally."',introVideoUrl:"https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c305e33ab4d91e7fc7763d.mp4",posterImageUrl:"/images/photos/journal-base/base-hand-balancer-3s.jpg",durationLabel:"1 min"},U={name:"The Elbow Reset",framingLine:'"From all the overuse we do with the forearm, the tendon gets inflamed. This is a great tool for any kind of dysfunction of the elbow or forearm."',introVideoUrl:"https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30e9b6bd30ff0fd318d61.mp4",posterImageUrl:"/images/photos/journal-base/base-elbow-reset-6s.jpg",durationLabel:"1 min"},_={quote:"I thought the best I could hope for was less pain. I've never felt this at home in my body.",name:"Sara",attribution:"Low back relief"},N={quote:"I went from barely walking to six-mile hikes. I didn't think that was possible for me again after my accident.",name:"Becca",attribution:"Hip pain"},I={quote:"I finally understand WHY my neck has been hurting. That's worth more than any treatment I've ever had.",name:"Tyler",attribution:"Photographer · neck"},S={quote:"My shoulder was just the weakest link. Huge a-ha moment.",name:"Paul",attribution:"Weightlifter · shoulder"},w={quote:"One visit with Garrett gave me better results than three months of physical therapy.",name:"Katie",attribution:"Runner recovery"},A={quote:"I follow his protocol every day. 8 months no pain.",name:"Marisol",attribution:"Teacher"},q={"lower-back":_,hips:N,hip:N,neck:I,shoulders:S,shoulder:S,"upper-back":I,knees:w,knee:w,"ankles-feet":w,"wrists-hands":A,elbows:A},G={"lower-back":x,hips:x,hip:x,neck:f,shoulders:f,shoulder:f,"upper-back":f,knees:v,knee:v,"ankles-feet":v,"wrists-hands":M,elbows:U},V={"lower-back":H,neck:R,shoulders:k,shoulder:k,hips:j,hip:j,knees:T,knee:T};function E(t){if(!t)return null;const r=t.toLowerCase().replace(/\s*\/\s*/g,"-").replace(/\s+/g,"-"),a=V[r]??Y(t,r),n=G[r],o=q[r];return{...a,...n&&{protocolIntro:n},...o&&{matchedTestimonial:o}}}const $=({buildBookingUrl:t})=>{const{answers:r,referralSource:a}=z(),n=r[0]?.answer||null,s=E(n)?.matchedTestimonial,l=a?a.charAt(0).toUpperCase()+a.slice(1):null;return e.jsxs("div",{id:"booking-cta",children:[e.jsxs("article",{className:"offer",children:[e.jsxs("header",{className:"offer-head",children:[e.jsx("span",{children:"Amari Assessment · 50 minutes · San Francisco"}),e.jsx("span",{className:"pill",children:"Recommended"})]}),e.jsxs("div",{className:"offer-body",children:[e.jsxs("div",{className:"offer-pane",children:[e.jsx("div",{className:"offer-price-num",children:"$29"}),e.jsx("div",{className:"offer-price-lbl",children:"Private, in-person Assessment"}),e.jsx("p",{className:"offer-price-meta",children:"Start with an Assessment and experience the work in person."})]}),e.jsx("div",{className:"offer-pane",children:e.jsxs("div",{className:"offer-included",children:[e.jsx("span",{className:"eyebrow",children:"What's included"}),e.jsxs("ul",{className:"offer-list",children:[e.jsx("li",{children:"A focused look at what you are noticing in your body"}),e.jsx("li",{children:"One-on-one, hands-on guided movement with Garrett"}),e.jsx("li",{children:"Space to experience the work before deciding on a longer practice"})]})]})})]}),e.jsxs("div",{className:"offer-cta",children:[l?e.jsxs("p",{className:"referral-note",children:["Referred by ",l]}):null,e.jsx("div",{className:"booking-options",children:e.jsxs("a",{href:t("/assessment-booking"),className:"btn-ink",children:[e.jsx("span",{children:"Book your $29 Assessment"}),e.jsx("span",{className:"arrow",children:"→"})]})}),e.jsx("span",{className:"fine",children:"50 minutes · Private · In person in San Francisco"})]})]}),s?e.jsxs("section",{className:"testimonial",children:[e.jsx("blockquote",{children:s.quote}),e.jsxs("cite",{children:[s.name," · ",s.attribution]})]}):null]})};function P(t){const r=["actually comes from","keeps coming back","keeps hurting","comes from"];for(const s of r)if(t.toLowerCase().endsWith(s)){const l=t.slice(0,t.length-s.length),h=t.slice(t.length-s.length);return e.jsxs(e.Fragment,{children:[l,h,"."]})}const a=t.split(" ");if(a.length<3)return e.jsxs(e.Fragment,{children:[t,"."]});const n=a.slice(0,-2).join(" ")+" ",o=a.slice(-2).join(" ");return e.jsxs(e.Fragment,{children:[n,o,"."]})}function K(t){return t.toLowerCase().startsWith("the ")?e.jsxs(e.Fragment,{children:["The ",t.slice(4),"."]}):e.jsxs(e.Fragment,{children:[t,"."]})}const Q=({content:t})=>{const r=t.protocolIntro?.durationLabel?.toUpperCase()??"";return e.jsxs(e.Fragment,{children:[e.jsxs("section",{className:"doc sect",children:[e.jsxs("div",{className:"section-head",style:{borderTop:"none",marginTop:0,paddingTop:48},children:[e.jsx("span",{className:"eyebrow",children:"Why it keeps hurting"}),e.jsx("h2",{children:P(t.whyHeading)}),e.jsx("p",{className:"lede",children:t.whySubline})]}),e.jsx("div",{className:"why-cards",children:t.whyCards.map(a=>e.jsxs("div",{className:"why-card",children:[e.jsx("span",{className:"n",children:a.num}),e.jsx("h3",{children:a.title}),e.jsx("p",{children:a.body})]},a.num))})]}),t.protocolIntro?e.jsxs("section",{className:"doc sect",children:[e.jsxs("div",{className:"section-head",style:{borderTop:"none",marginTop:0,paddingTop:0},children:[e.jsx("span",{className:"eyebrow",children:"A taste of the work"}),e.jsx("h2",{children:K(t.protocolIntro.name)})]}),e.jsxs("div",{className:"video-block",children:[e.jsx("p",{className:"pull",children:t.protocolIntro.framingLine}),e.jsxs("div",{className:"video-frame-outer",children:[e.jsx("span",{className:"corner-bl","aria-hidden":"true"}),e.jsx("span",{className:"corner-br","aria-hidden":"true"}),e.jsx("div",{className:"video-frame-inner",children:e.jsx("video",{src:t.protocolIntro.introVideoUrl,poster:t.protocolIntro.posterImageUrl,controls:!0,preload:"metadata",playsInline:!0})})]}),e.jsxs("div",{className:"video-cap",children:[e.jsxs("span",{children:[r," · Garrett introducing the protocol"]}),e.jsxs("span",{children:["Fig. ",t.protocolIntro.name]})]}),e.jsx("p",{className:"video-note",children:"The actual hands-on guidance lives in your first session, where Garrett adapts the protocol to your specific body."})]})]}):null,e.jsxs("section",{className:"doc sect",children:[e.jsxs("div",{className:"section-head",style:{borderTop:"none",marginTop:0,paddingTop:0},children:[e.jsx("span",{className:"eyebrow",children:"The pattern"}),e.jsx("h2",{children:P(t.chainHeading)}),e.jsx("p",{className:"lede",children:t.chainSubline})]}),e.jsx("div",{className:"chain",children:t.chainSteps.map(a=>e.jsxs("div",{className:"chain-step",children:[e.jsxs("div",{className:"lead",children:[e.jsx("span",{className:"n",children:a.num}),e.jsx("div",{className:"flow",children:a.flow})]}),e.jsxs("div",{children:[e.jsx("h3",{children:a.title}),e.jsx("p",{children:a.body})]})]},a.num))}),t.conditionPageSlug?e.jsxs("p",{className:"chain-foot",children:["Want the full breakdown?"," ",e.jsxs("a",{href:`https://www.amarimethod.com/${t.conditionPageSlug}`,children:["Read the full ",t.displayName.toLowerCase()," page →"]})]}):null]})]})},X=`
[data-results] {
  --cream:#F7F6F1; --cream-2:#ECEDE7; --paper:#FBFBF8; --paper-2:#ECEDE7;
  --ink:#171A18; --ink-2:#59615C; --body:#59615C; --mute:#59615C;
  --line:rgba(23,26,24,.14); --line-2:rgba(23,26,24,.32); --line-strong:rgba(23,26,24,.32);
  --accent:#526D73; --rust:#526D73; --forest:#171A18; --gold:#526D73; --teal:#526D73;
  --display:"ABC Diatype","Helvetica Neue",Arial,sans-serif;
  --sans:"ABC Diatype","Helvetica Neue",Arial,sans-serif;
  --ease:cubic-bezier(0.32,0.72,0,1);
  background:var(--cream); color:var(--ink); font-family:var(--sans);
  -webkit-font-smoothing:antialiased; font-size:16px; line-height:1.65;
  overflow-x:hidden;
}
[data-results] *{box-sizing:border-box}
[data-results] a{color:inherit;text-decoration:none}
[data-results] img,[data-results] video{display:block;max-width:100%}
[data-results] h1,[data-results] h2,[data-results] h3,[data-results] h4{
  font-family:var(--display);font-weight:500;letter-spacing:0;
  line-height:1.14;color:var(--ink);text-wrap:balance;margin:0;
}
[data-results] p{text-wrap:pretty;margin:0;color:var(--body)}
[data-results] em{font-style:normal;color:inherit}

[data-results] .doc{max-width:840px;margin:0 auto;padding:0 32px}
[data-results] .doc-narrow{max-width:840px;margin:0 auto;padding:0 32px}

[data-results] .detail{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);
}

[data-results] .eyebrow{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.2em;
  text-transform:uppercase;color:var(--rust);display:inline-flex;align-items:baseline;gap:6px;
}
[data-results] .eyebrow::before{content:none}

[data-results] .doc-bar{
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--body);padding:22px 32px;border-bottom:1px solid var(--line);flex-wrap:wrap;
  max-width:840px;margin:0 auto;background:transparent;
}
[data-results] .doc-bar-inner{
  width:100%;max-width:840px;margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:0;
}
[data-results] .doc-bar .brand{
  display:inline-flex;align-items:center;width:228px;color:var(--ink);
}
[data-results] .doc-bar .brand img{display:block;width:100%;height:auto}
[data-results] .doc-bar .center{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--body);text-align:center;
}
[data-results] .doc-bar .right{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--body);
}
[data-results] .doc-bar .right a{border-bottom:1px solid var(--line-strong);padding-bottom:2px}
[data-results] .doc-bar .right a:hover{color:var(--ink);border-color:var(--ink)}

/* ── HERO ─────────────────────────────────────────────────────────── */
[data-results] .hero-finding{padding:44px 0 8px;text-align:left}
[data-results] .hero-stamp{
  display:inline-flex;align-items:center;gap:9px;
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.18em;
  text-transform:uppercase;color:var(--rust);
  border:1px solid rgba(169,72,31,.3);border-radius:2px;padding:7px 14px;margin-bottom:0;
}
[data-results] .hero-stamp .glyph{font-family:var(--display);font-size:16px;line-height:0;letter-spacing:0}
[data-results] .hero-headline{
  margin-top:24px;font-family:var(--display);font-weight:500;
  font-size:clamp(2.4rem,5.4vw,3.6rem);letter-spacing:0;line-height:1.08;
  max-width:18ch;margin-left:0;margin-right:0;margin-bottom:0;
}
[data-results] .hero-sub{
  margin-top:22px;font-family:var(--sans);font-style:normal;
  font-size:1.15rem;max-width:50ch;line-height:1.55;font-weight:400;color:var(--body);
}
[data-results] .hero-sub em{font-style:normal;color:var(--ink)}
[data-results] .hero-meta{
  margin-top:34px;display:grid;grid-template-columns:1fr;gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:3px;overflow:hidden;
  max-width:none;
}
[data-results] .hero-meta .cell{background:var(--paper);padding:20px 22px;text-align:left}
[data-results] .hero-meta .cell + .cell{border-left:none}
[data-results] .hero-meta .lbl{
  display:block;font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);margin-bottom:0;
}
[data-results] .hero-meta .val{
  display:block;margin-top:9px;font-family:var(--display);font-size:1.55rem;
  font-style:normal;font-weight:500;color:var(--ink);
}
[data-results] .hero-meta .val em{font-style:normal;color:var(--ink)}

/* ── SECTION HEAD ────────────────────────────────────────────────── */
[data-results] .section-head,[data-results] .sect{
  padding:48px 0 8px;border-top:1px solid var(--line);margin-top:48px;text-align:left;
}
[data-results] .section-head .eyebrow{margin-bottom:0;color:var(--rust)}
[data-results] .section-head h2,[data-results] .sect h2{
  margin-top:16px;font-family:var(--display);font-size:clamp(1.9rem,3.8vw,2.7rem);font-weight:500;
  letter-spacing:0;line-height:1.14;max-width:20ch;margin-left:0;margin-right:0;margin-bottom:0;
}
[data-results] .section-head .lede,[data-results] .sect .sub{
  margin-top:14px;font-family:var(--sans);font-style:normal;font-size:1.05rem;color:var(--body);
  max-width:54ch;margin-left:0;margin-right:0;line-height:1.55;
}

/* ── WHY CARDS (3-up) ────────────────────────────────────────────── */
[data-results] .why-cards,[data-results] .cred-grid{
  margin-top:30px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;
  border:none;margin-bottom:8px;
}
[data-results] .why-card,[data-results] .cred-cell{
  background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:24px;
  display:flex;flex-direction:column;gap:0;
}
[data-results] .cred-cell + .cred-cell{border-left:1px solid var(--line)}
[data-results] .why-card .n,[data-results] .cred-cell .num{
  font-family:var(--display);font-size:1.4rem;color:var(--gold);font-weight:500;
  letter-spacing:0;text-transform:none;
}
[data-results] .why-card h3,[data-results] .cred-cell h3{
  margin-top:12px;font-family:var(--display);font-size:1.3rem;font-weight:500;line-height:1.2;color:var(--ink);
}
[data-results] .why-card p,[data-results] .cred-cell p{
  margin-top:12px;font-family:var(--sans);font-size:.95rem;line-height:1.55;color:var(--body);
}

/* ── PROTOCOL VIDEO BLOCK ────────────────────────────────────────── */
[data-results] .video-block{padding:26px 0 8px}
[data-results] .video-block .pull{
  font-family:var(--display);font-style:normal;font-size:1.15rem;
  color:var(--body);max-width:46ch;margin:0 0 20px;text-align:left;line-height:1.4;font-weight:400;
}
[data-results] .protocol{
  margin-top:26px;background:var(--forest);color:#fff;border-radius:3px;
  padding:34px clamp(26px,4vw,42px);display:flex;align-items:center;gap:26px;flex-wrap:wrap;
}
[data-results] .video-frame-outer{
  position:relative;max-width:100%;margin:0;padding:0;border:none;
}
[data-results] .video-frame-outer::before,
[data-results] .video-frame-outer::after,
[data-results] .video-frame-outer .corner-bl,
[data-results] .video-frame-outer .corner-br{display:none}
[data-results] .video-frame-inner{
  border:none;background:transparent;padding:0;border-radius:3px;overflow:hidden;
}
[data-results] .video-frame-inner video{
  width:100%;aspect-ratio:16/9;background:#000;display:block;border-radius:3px;
}
[data-results] .video-cap{
  display:flex;justify-content:space-between;align-items:baseline;
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--body);
  margin:14px 0 0;flex-wrap:wrap;gap:8px;
}
[data-results] .video-note{
  font-family:var(--sans);font-size:.95rem;color:var(--body);line-height:1.55;
  max-width:54ch;margin:18px 0 0;text-align:left;
}

/* ── CHAIN ────────────────────────────────────────────────────────── */
[data-results] .chain,[data-results] .chain-grid{
  margin-top:30px;display:flex;flex-direction:column;gap:0;
  border:none;
}
[data-results] .chain-grid{display:flex;flex-direction:column}
[data-results] .chain-grid.is-4{display:flex;flex-direction:column}
[data-results] .chain-step,[data-results] .chain-cell{
  display:grid;grid-template-columns:auto 1fr;gap:22px;padding:22px 0;
  border-top:1px solid var(--line);background:transparent;border-radius:0;
}
[data-results] .chain-step:first-child,[data-results] .chain-cell:first-child{border-top:none}
[data-results] .chain-cell + .chain-cell{border-left:none}
[data-results] .chain-step .lead{min-width:120px}
[data-results] .chain-step .n,[data-results] .chain-cell .num{
  font-family:var(--display);font-size:1.5rem;color:var(--gold);font-style:normal;font-weight:500;line-height:1;
}
[data-results] .chain-step .flow,[data-results] .chain-cell .flow{
  margin-top:6px;font-family:var(--sans);font-size:10.5px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--teal);
}
[data-results] .chain-step h3,[data-results] .chain-cell h3{
  font-family:var(--display);font-size:1.35rem;font-weight:500;line-height:1.2;color:var(--ink);
}
[data-results] .chain-step p,[data-results] .chain-cell p{
  margin-top:10px;font-family:var(--sans);font-size:.98rem;line-height:1.55;color:var(--body);
}
[data-results] .chain-foot{
  text-align:left;font-family:var(--sans);font-style:normal;
  font-size:.95rem;color:var(--body);padding:18px 0 8px;
}
[data-results] .chain-foot a{color:var(--ink);border-bottom:1px solid var(--line-strong)}
[data-results] .chain-foot a:hover{color:var(--rust);border-color:var(--rust)}

/* ── ASSESSMENT EXPLANATION ──────────────────────────────────────── */
[data-results] .assessment-note{
  margin-top:48px;border-top:1px solid var(--line);padding:40px 0 8px;
}
[data-results] .assessment-note h2{
  margin-top:16px;font-size:clamp(1.9rem,3.8vw,2.7rem);max-width:18ch;
}
[data-results] .assessment-note p{
  margin-top:16px;font-size:1.12rem;line-height:1.58;max-width:54ch;color:var(--ink);
}
/* ── OFFER CARD ──────────────────────────────────────────────────── */
[data-results] .offer{
  margin-top:0;border:1px solid var(--line-strong);border-radius:4px;overflow:hidden;
  background:var(--paper);max-width:780px;margin-left:auto;margin-right:auto;
}
[data-results] .offer-head{
  background:transparent;border-bottom:1px solid var(--line);
  padding:18px 26px;display:flex;justify-content:space-between;align-items:center;
  font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:.06em;
  text-transform:none;color:var(--body);flex-wrap:wrap;gap:12px;
}
[data-results] .offer-head .pill{
  font-family:var(--sans);font-size:10px;letter-spacing:.16em;text-transform:uppercase;
  color:#fff;background:var(--rust);border:none;padding:5px 11px;border-radius:2px;
}
[data-results] .offer-body{display:grid;grid-template-columns:.85fr 1.15fr;gap:0}
[data-results] .offer-pane{padding:30px 26px}
[data-results] .offer-pane + .offer-pane{border-left:1px solid var(--line)}
[data-results] .offer-price-num{
  font-family:var(--display);font-size:3.4rem;font-weight:500;letter-spacing:0;
  color:var(--ink);line-height:1;
}
[data-results] .offer-price-lbl{
  margin-top:10px;font-family:var(--sans);font-size:.85rem;font-weight:600;
  letter-spacing:.02em;text-transform:none;color:var(--ink);
}
[data-results] .offer-price-meta{
  margin-top:14px;font-family:var(--sans);font-size:.9rem;line-height:1.5;color:var(--body);
}
[data-results] .offer-included{display:flex;flex-direction:column;gap:0}
[data-results] .offer-included .eyebrow,.offer-path .eyebrow{color:var(--rust)}
[data-results] .offer-list{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}
[data-results] .offer-list li{
  position:relative;padding-left:22px;font-family:var(--sans);font-size:.95rem;color:var(--ink);
  display:block;gap:0;align-items:unset;line-height:1.5;
}
[data-results] .offer-list li::before{
  content:"✦";position:absolute;left:0;color:var(--gold);font-size:.85rem;
  font-family:var(--sans);font-style:normal;flex-shrink:0;
}
[data-results] .offer-path{
  margin-top:26px;padding-top:22px;border-top:1px solid var(--line);
  border-left:none;border-right:none;border-bottom:none;padding-left:0;padding-right:0;background:transparent;
}
[data-results] .offer-path .eyebrow{margin-bottom:0}
[data-results] .offer-path .row{margin-top:11px;font-size:.92rem;line-height:1.5;display:block;padding:0}
[data-results] .offer-path .row + .row{border-top:none}
[data-results] .offer-path .lbl{
  font-family:var(--sans);font-size:.92rem;letter-spacing:0;text-transform:none;
  color:var(--ink);font-weight:600;margin-right:6px;
}
[data-results] .offer-path .body{font-family:var(--sans);font-size:.92rem;color:var(--body);line-height:1.5}
[data-results] .offer-cta{
  padding:28px 26px;border-top:1px solid var(--line);text-align:center;
  display:flex;flex-direction:column;gap:0;align-items:center;
}
[data-results] .btn-ink{
  display:inline-flex;align-items:center;gap:.7em;background:var(--ink);color:#fff;
  font-family:var(--sans);font-weight:600;font-size:12px;text-transform:uppercase;
  letter-spacing:.16em;padding:17px 34px;border-radius:2px;border:none;cursor:pointer;
  transition:background .3s var(--ease),transform .3s var(--ease);width:auto;max-width:none;
}
[data-results] .btn-ink:hover{background:#000;transform:translateY(-1px);gap:.7em;color:#fff}
[data-results] .btn-ink .arrow{font-family:inherit;font-style:normal;font-size:inherit;letter-spacing:inherit;transition:transform .3s var(--ease)}
[data-results] .btn-ink:hover .arrow{transform:translateX(4px)}
[data-results] .booking-options{display:grid;grid-template-columns:1fr;gap:10px;max-width:560px;margin:0 auto}
[data-results] .booking-options.virtual-first .btn-paper{order:-1;background:var(--ink);color:#fff;border-color:var(--ink)}
[data-results] .booking-options.virtual-first .btn-ink{background:var(--paper);color:var(--ink);border:1px solid var(--ink)}
[data-results] .btn-paper{
  display:inline-flex;align-items:center;justify-content:center;gap:.7em;width:auto;
  padding:17px 34px;border:1px solid var(--ink);background:var(--paper);color:var(--ink);
  font-family:var(--sans);font-weight:600;font-size:12px;letter-spacing:.16em;text-transform:uppercase;
  transition:background .3s var(--ease),transform .3s var(--ease);
}
[data-results] .btn-paper:hover{background:var(--paper-2);transform:translateY(-1px)}
[data-results] .btn-paper .arrow{font-family:inherit;font-style:normal;font-size:inherit;letter-spacing:inherit;transition:transform .3s var(--ease)}
[data-results] .btn-paper:hover .arrow{transform:translateX(4px)}
[data-results] .referral-note{
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--rust);text-align:center;margin:0 0 14px;
}
[data-results] .offer-cta .fine{
  display:block;margin-top:14px;font-family:var(--sans);font-size:11px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--body);
}
[data-results] .offer-cta .guarantee{
  margin-top:18px;font-family:var(--sans);font-size:.9rem;line-height:1.5;max-width:52ch;
  margin-left:auto;margin-right:auto;color:var(--body);text-align:center;
  border-top:none;padding-top:0;
}
[data-results] .offer-cta .guarantee b{color:var(--ink);font-weight:600}

/* ── TESTIMONIAL ─────────────────────────────────────────────────── */
[data-results] .testimonial{margin-top:40px;text-align:center;padding:0 12px}
[data-results] .testimonial blockquote{
  font-family:var(--display);font-style:normal;font-weight:400;
  font-size:clamp(1.6rem,3.2vw,2.2rem);line-height:1.32;color:var(--ink);
  letter-spacing:0;max-width:26ch;margin:0 auto;
}
[data-results] .testimonial blockquote::before{display:none}
[data-results] .testimonial cite{
  font-style:normal;display:block;margin-top:22px;
  font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--body);
}

/* ── ASIDE LINKS ─────────────────────────────────────────────────── */
[data-results] .aside-links{
  margin-top:44px;padding:0;display:flex;gap:28px;justify-content:center;flex-wrap:wrap;
  font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--body);
  max-width:none;
}
[data-results] .aside-links a{
  font-family:var(--sans);font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--body);text-align:center;padding:0 0 3px;border:none;border-bottom:1px solid var(--line-strong);
  border-radius:0;white-space:nowrap;background:transparent;
}
[data-results] .aside-links a:hover{color:var(--ink);border-color:var(--ink);background:transparent}
@media (max-width:520px){
  [data-results] .aside-links{flex-direction:column;align-items:center;padding:0}
  [data-results] .aside-links a{white-space:normal}
}

/* ── APPENDIX ────────────────────────────────────────────────────── */
[data-results] .appendix{
  border-top:1px solid var(--line);padding:48px 0 64px;background:var(--paper);
}
[data-results] .appendix summary{
  list-style:none;cursor:pointer;display:flex;justify-content:space-between;
  align-items:center;padding:22px 24px;
  border:1px solid var(--line);border-radius:14px;
  background:var(--paper);
  font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-2);gap:16px;flex-wrap:wrap;
  transition:border-color .18s ease, background-color .18s ease;
}
[data-results] .appendix summary:hover{border-color:var(--ink);background:#f6f1e6}
[data-results] .appendix summary::-webkit-details-marker{display:none}
[data-results] .appendix summary .label{
  font-family:var(--display);font-style:normal;font-size:20px;
  letter-spacing:-0.01em;color:var(--ink);text-transform:none;
}
[data-results] .appendix summary .label::before{
  content:"§ ";font-style:normal;color:var(--accent);
}
[data-results] .appendix summary .toggle{
  font-family:var(--display);font-style:normal;font-size:24px;color:var(--accent);
  width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--accent);border-radius:50%;line-height:1;
  transition:transform .18s ease;
}
[data-results] details[open] .appendix summary .toggle,
[data-results] .appendix details[open] summary .toggle{transform:rotate(45deg)}
[data-results] .appendix-body{padding-top:32px;display:flex;flex-direction:column;gap:48px}
[data-results] .response-map-grid{display:grid;grid-template-columns:minmax(0,360px) 1fr;gap:56px;align-items:center}
[data-results] .response-map{padding:20px;background:var(--paper);border:1px solid var(--line)}
[data-results] .response-map svg{display:block;width:100%;height:auto;overflow:visible}
[data-results] .response-map-gridline,[data-results] .response-map-axis{fill:none;stroke:var(--line-strong);stroke-width:1}
[data-results] .response-map-shape{fill:var(--accent);fill-opacity:.14;stroke:var(--accent);stroke-width:2}
[data-results] .response-map-point{fill:var(--accent);stroke:var(--paper);stroke-width:2}
[data-results] .response-map-key{display:grid;gap:14px}
[data-results] .response-map-key-row{display:flex;align-items:center;gap:10px;font-family:var(--sans);font-size:14px;font-weight:500;color:var(--ink)}
[data-results] .response-map-key-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:0 0 auto}

/* ── DOC FOOT ────────────────────────────────────────────────────── */
[data-results] .doc-foot{
  padding:48px 32px;border-top:1px solid var(--line);
  display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;align-items:end;
  font-family:var(--sans);font-size:10.5px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--mute);max-width:1100px;margin:0 auto;
}
[data-results] .doc-foot .col b{
  color:var(--ink);font-weight:500;letter-spacing:.18em;
  display:block;margin-bottom:6px;
}
[data-results] .doc-foot .center{
  text-align:center;font-family:var(--display);font-style:normal;
  font-size:16px;letter-spacing:0;color:var(--ink-2);text-transform:none;
}
[data-results] .doc-foot .right{text-align:right}
[data-results] .doc-foot a:hover{color:var(--accent)}

/* ── SHARE STRIP ─────────────────────────────────────────────────── */
/* ── MOBILE ──────────────────────────────────────────────────────── */
@media(max-width:720px){
  [data-results] .doc,[data-results] .doc-narrow{padding:0 20px}
  [data-results] .doc-bar{padding:18px 20px}
  [data-results] .doc-bar .brand{width:190px}
  [data-results] .doc-bar .center{display:none}
  [data-results] .hero-finding{padding:32px 0 8px}
  [data-results] .hero-meta{grid-template-columns:1fr}
  [data-results] .why-cards,[data-results] .cred-grid{grid-template-columns:1fr}
  [data-results] .response-map-grid{grid-template-columns:1fr;gap:28px}
  [data-results] .chain-step,[data-results] .chain-cell{grid-template-columns:1fr;gap:8px}
  [data-results] .offer-body{grid-template-columns:1fr}
  [data-results] .offer-pane + .offer-pane{border-left:none;border-top:1px solid var(--line)}
  [data-results] .booking-options{grid-template-columns:1fr}
  [data-results] .booking-options.virtual-first .btn-paper{order:initial}
  [data-results] .doc-foot{grid-template-columns:1fr;text-align:left;gap:18px;padding:32px 20px}
  [data-results] .doc-foot .center,[data-results] .doc-foot .right{text-align:left}
}

@media(max-width:480px){
  [data-results] .offer-pane{padding:24px 20px}
  [data-results] .offer-price-num{font-size:3rem}
  [data-results] .btn-ink{padding:16px 24px}
}
`,ee=({firstName:t,patternSignature:r,scores:a,insights:n})=>{const{answers:o}=z(),s=o[0]?.answer||null,l=E(s);function h(b){if(!s)return b;const C=s.toLowerCase().replace(/\s*\/\s*/g,"-").replace(/\s+/g,"-"),W=b.includes("?")?"&":"?";return`${b}${W}pain=${encodeURIComponent(C)}`}return e.jsxs("div",{"data-results":!0,children:[e.jsx("style",{dangerouslySetInnerHTML:{__html:X}}),e.jsx("div",{className:"doc-bar",children:e.jsxs("div",{className:"doc-bar-inner",children:[e.jsx("a",{className:"brand",href:"https://www.amarimethod.com/",children:e.jsx("img",{src:"/images/identity/amari-method-wordmark.svg",alt:"Amari Method"})}),e.jsx("div",{className:"center",children:"Your result · Pain pattern quiz"}),e.jsx("div",{className:"right",children:e.jsx("a",{href:"/quiz/take/",children:"← Retake quiz"})})]})}),e.jsx(O,{firstName:t,patternSignature:r}),l?e.jsx(Q,{content:l}):null,e.jsxs("section",{className:"assessment-note doc",children:[e.jsx("span",{className:"eyebrow",children:"The Assessment"}),e.jsx("h2",{children:"Experience the work directly."}),e.jsx("p",{children:"Garrett works with what is present in your body that day. You move, breathe, and receive hands-on guidance through a precise physical setup—then decide whether a longer Amari practice is right for you."})]}),e.jsx("section",{style:{padding:"64px 0"},children:e.jsx("div",{className:"doc",children:e.jsx($,{buildBookingUrl:h})})}),e.jsx("div",{className:"doc",children:e.jsxs("div",{className:"aside-links",children:[e.jsx("a",{href:h("/assessment-booking?type=discovery_call"),children:"Schedule free 15-min call ↗"}),e.jsx("a",{href:h("/assessment-booking"),children:"Start with a $29 Assessment ↗"})]})}),e.jsx("section",{className:"appendix",children:e.jsx("div",{className:"doc",children:e.jsxs("details",{children:[e.jsxs("summary",{children:[e.jsx("span",{className:"label",children:"Appendix · See your full readout"}),e.jsx("span",{className:"detail",children:"Response overview / Balance equation"}),e.jsx("span",{className:"toggle","aria-hidden":"true",children:"+"})]}),e.jsxs("div",{className:"appendix-body",children:[e.jsx(B,{insights:n}),e.jsx(F,{scores:a}),e.jsxs("div",{children:[e.jsxs("div",{className:"section-head",style:{paddingTop:0},children:[e.jsx("span",{className:"eyebrow",children:"The balance equation"}),e.jsx("h2",{children:"Pain emerges when some parts overwork because other parts aren't working enough."})]}),e.jsxs("div",{className:"cred-grid",style:{gridTemplateColumns:"repeat(2, 1fr)",marginBottom:32},children:[e.jsx("div",{className:"cred-cell",children:e.jsx(m,{title:"Active System",subtitle:"Muscles & Tendons",score:a.softTissueTension,description:"Your muscular system works to provide active support. Higher scores indicate your muscles are working overtime to create stability."})}),e.jsx("div",{className:"cred-cell",children:e.jsx(m,{title:"Passive System",subtitle:"Bones & Ligaments",score:a.jointBoneAlignment,description:"Your skeletal system provides your structural foundation. Higher scores suggest alignment adaptations that affect how force transfers."})})]}),e.jsxs("div",{className:"cred-grid",children:[e.jsx("div",{className:"cred-cell",children:e.jsx(m,{title:"Pattern Duration",score:a.patternDuration,description:"How long your pattern has been developing affects how established the compensation pattern is.",compact:!0})}),e.jsx("div",{className:"cred-cell",children:e.jsx(m,{title:"Daily Impact",score:a.dailyActivitiesImpact,description:"How your pain affects your daily activities reveals functional limitations and compensations.",compact:!0})}),e.jsx("div",{className:"cred-cell",children:e.jsx(m,{title:"Body Adaptations",score:a.bodyAdaptations,description:"The degree to which your body has developed compensatory strategies around pain.",compact:!0})})]})]})]})]})})}),e.jsxs("footer",{className:"doc-foot",children:[e.jsxs("div",{className:"col",children:[e.jsx("b",{children:"Pain pattern quiz"}),e.jsx("span",{children:"Returned 2026"})]}),e.jsx("div",{className:"col center",children:"A reading, not a diagnosis · Issued by Amari Method"}),e.jsxs("div",{className:"col right",children:[e.jsx("b",{children:"Amari Method"}),e.jsx("a",{href:"https://www.amarimethod.com/",children:"Return to home ↗"})]})]})]})};export{ee as default};
