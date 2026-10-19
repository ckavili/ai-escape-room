export const challenges = [
  {
    id:1,type:'model',title:'Happy customer?',subtitle:'Pick a model. Let it do the job.',
    task:'Label this review POSITIVE or NEGATIVE.\n\n“Easy to set up. Works perfectly. I would buy it again.”\n\nReturn one word only.',
    expected:'POSITIVE',
    lesson:'A short classification task is a good place to test your least expensive model.',
    comparison:'Compare accuracy across models before paying for more capability. Demo responses do not measure model performance.',
  },
  {
    id:2,type:'prompt',title:'Just the speakers',subtitle:'Tell the AI what to keep.',
    task:'Get the AI to return only the speakers’ names, separated by commas. No other names or explanation.',
    source:'Maya — speaker\nLeo — photographer\nNora — speaker',
    expected:'MAYA,NORA',
    lesson:'A useful instruction says what to extract and how to return it.',
    comparison:'Try a shorter instruction that preserves the same result. Live evaluation is needed to compare reliability.',
  },
  {
    id:3,type:'context',title:'Where is lunch?',subtitle:'Pick the note the AI needs.',
    task:'Which floor is lunch on TODAY?\n\nSelect the notes to send. The AI must return the floor number only.',
    documents:[
      {id:'yesterday',title:'Yesterday’s schedule',text:'Lunch was on floor 1 at 12:00.'},
      {id:'today',title:'Today’s schedule',text:'Lunch is on floor 2 at 12:30.'},
      {id:'wifi',title:'Wi-Fi details',text:'Network: ConferenceGuest. Ask the welcome desk for the password.'},
    ],
    expected:'2',
    lesson:'Today’s schedule is enough. Yesterday’s schedule and Wi-Fi details add input without helping.',
    comparison:'Try the relevant note alone versus all notes. Compare correctness and input tokens on real models.',
  },
  {
    id:4,type:'model',title:'When are we done?',subtitle:'A little more thinking. Which model?',
    task:'It is 14:40.\nA meeting starts in 35 minutes.\nIt lasts 50 minutes.\n\nWhen does it END? Return HH:MM only.',
    expected:'16:05',
    lesson:'The model needs two steps: start at 15:15, then add 50 minutes. More steps are a reason to test reliability, not automatically choose Premium.',
    comparison:'Evaluate this task on each deployment. All model choices succeed in this interaction demo; no capability difference is claimed.',
  },
  {
    id:5,type:'prompt',title:'Make it fit',subtitle:'A shorter message. Same essentials.',
    task:'Ask the AI to shorten this announcement to 6 words or fewer. It must keep the time and the hall.',
    source:'A reminder for all attendees: the workshop starts at 15:00 in Hall B. Please arrive in plenty of time.',
    expected:'short-announcement',
    lesson:'Specify the length limit and the facts that must survive. Several different answers can be correct.',
    comparison:'Shorter output can reduce output tokens, but compare successful results rather than word count alone.',
  },
  {
    id:6,type:'context',title:'Can Sam eat this?',subtitle:'Two facts make the difference.',
    task:'Which snack can Sam eat: COOKIE or APPLE?\n\nSelect the notes the AI needs. It must return one word only.',
    documents:[
      {id:'diet',title:'Sam’s dietary needs',text:'Sam cannot eat dairy. Other ingredients are fine.'},
      {id:'menu',title:'Snack ingredients',text:'COOKIE: flour, sugar, butter, milk. APPLE: fresh apple only.'},
      {id:'drinks',title:'Drinks station',text:'Water and black coffee are available next to the entrance.'},
    ],
    expected:'APPLE',
    lesson:'Send both Sam’s dietary needs and the ingredients. The menu alone does not explain what Sam must avoid.',
    comparison:'Test missing context versus the two relevant notes. Extra information is useful only when it helps answer the question.',
  },
];
export function publicChallenge({expected,lesson,comparison,...rest}) { return rest; }
export function correct(challenge,text) {
  const cleaned=String(text).trim();
  if(challenge.expected==='short-announcement') {
    return cleaned.split(/\s+/).length<=6 && /\b15:00\b/.test(cleaned) && /\bhall\s+b\b/i.test(cleaned);
  }
  return cleaned.toUpperCase().replace(/\s+/g,'')===challenge.expected;
}
// Interaction fixtures, not predictions of any model's accuracy.
export function simulate(challenge,prompt,context) {
  if(challenge.type==='model') return challenge.expected;
  if(challenge.id===2) return /speaker/i.test(prompt) && /only|comma|nothing|no explanation/i.test(prompt) ? 'Maya, Nora' : 'Maya and Nora are speakers. Leo is the photographer.';
  if(challenge.id===5) return /6|six|short|brief|concise/i.test(prompt) && /time|15:00/i.test(prompt) && /hall|location|place/i.test(prompt) ? 'Workshop: 15:00, Hall B.' : 'The workshop starts at 15:00 in Hall B. Please arrive early.';
  if(challenge.id===3) return context.includes('today') ? '2' : context.includes('yesterday') ? '1' : 'I need today’s lunch schedule.';
  return context.includes('diet') && context.includes('menu') ? 'APPLE' : 'I need both Sam’s dietary needs and the snack ingredients.';
}
export function demoUsage(model,messages,text) {
  // Approximate input length plus random overhead; invented output overhead varies
  // by selected tier solely to make the prototype counters feel different.
  const input=Math.ceil(messages.reduce((n,m)=>n+m.content.length,0)/4)+40+Math.floor(Math.random()*41);
  const tier={fast:25,balanced:90,premium:220}[model.alias]??25;
  const output=Math.ceil(text.length/4)+tier+Math.floor(Math.random()*31);
  return {input,output};
}
