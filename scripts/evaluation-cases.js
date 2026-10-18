import {rooms} from '../rooms.js';
const count=(text,letter)=>[...text.toUpperCase()].filter(c=>c===letter).length.toString();
export const cases = [
  ...rooms.map(room=>({id:`room-${room.id}`,prompt:`${room.story}\n${room.clues.join('\n')}\n${room.question}\n${(room.documents||[]).map(doc=>doc.text).join('\n')}`,expected:room.answer})),
  {id:'count-strawberry',prompt:'How many letters R are in STRAWBERRY ERROR? Count case-insensitively.',expected:count('STRAWBERRY ERROR','R')},
  {id:'count-exception',prompt:'Count the letters R in this text, excluding everything inside square brackets: STRAWBERRY [ERROR] MIRROR. Count case-insensitively.',expected:count('STRAWBERRY MIRROR','R')},
  {id:'count-constraint',prompt:'Which word contains exactly two A letters: BANANA, PAPAYA, AVOCADO? Return the word.',expected:'AVOCADO'},
  {id:'context-missing',prompt:'A keypad follows an unspecified number pattern. 5 → ? Can the output be determined from this information alone? Answer UNKNOWN if not.',expected:'UNKNOWN'},
];
export function grade(text,expected) {
  // Do not guess from numbers mentioned in explanations. Keep format failures separate.
  try {
    const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const value=JSON.parse(cleaned)?.answer;
    if (typeof value !== 'string' && typeof value !== 'number') return {status:'format_error',correct:false};
    return {status:'answered',correct:String(value).trim().toUpperCase()===expected.toUpperCase()};
  } catch { return {status:'format_error',correct:false}; }
}
