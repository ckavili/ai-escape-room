// Only publicRoom() output is sent to the browser. Answers and demo text stay server-side.
export const rooms = [
  {
    id: 1, title: 'The quiet vault', lesson: 'Do I need AI?',
    story: 'The station has gone silent. One locked vault holds your exit key. A handwritten note sits beside its three-digit keypad.',
    clues: ['The digits are consecutive, in ascending order.', 'All three digits add up to 12.', 'Enter the digits from left to right.'],
    question: 'What is the three-digit access code?', answer: '345',
    explanation: '3 + 4 + 5 = 12. Your own reasoning was enough to open this vault.',
    demo: 'The middle digit is the average: 12 ÷ 3 = 4. Its neighbors are 3 and 5, so try 345.',
  },
  {
    id: 2, title: 'The broken transmission', lesson: 'How much help do I need?',
    story: 'The vault opens onto a junction. A damaged transmission hides the direction to the exit. Which way should you go?',
    clues: ['Nothing responds on the bridge.', 'Only the emergency lights remain.', 'Restore the backup channel.', 'Then leave the station.', 'Hurry before the batteries fail.'],
    question: 'Which direction is hidden in the message?', choices: ['NORTH', 'EAST', 'SOUTH', 'WEST'], answer: 'NORTH',
    hint: 'Look at where each line begins.',
    explanation: 'The first letters spell NORTH. A small hint can be enough—you don’t always need a full solution.',
    demo: 'Read the first letter of each line: N, O, R, T, H. Go NORTH.',
  },
  {
    id: 3, title: 'The unreliable doors', lesson: 'Which model is worth it?',
    story: 'Three doors. One exit. Exactly ONE of the signs is true. The other two are false. Which door leads out?',
    clues: ['RED door: “The exit is behind BLUE.”', 'BLUE door: “The exit is not behind BLUE.”', 'GREEN door: “The exit is not behind RED.”'],
    question: 'Which door leads to the exit?', choices: ['RED', 'BLUE', 'GREEN'], answer: 'RED',
    explanation: 'If RED is the exit, only the BLUE sign is true. Either other exit would make two signs true. A confident answer still needs to satisfy every clue.',
    demo: 'Choose RED. Then the RED sign is false, the BLUE sign is true, and the GREEN sign is false—exactly one true sign.',
  },
  {
    id: 4, title: 'The missing symbol', lesson: 'What does AI need to see?',
    story: 'The next keypad follows a number pattern. Find the missing number.',
    clues: [],
    documents: [{ id: 'examples', title: 'Examples', text: '2 → 6\n3 → 12\n4 → 20' }],
    question: '5 → ?', choices: ['25', '30', '35'], answer: '30',
    explanation: 'The intended rule is n × (n + 1): 5 × 6 = 30. The examples give AI the pattern; “5 → ?” alone leaves it guessing.',
    demo: 'The examples follow n × (n + 1). So 5 × 6 = 30.',
  },
];
export const publicRoom = ({answer, demo, hint, explanation, ...room}) => ({...room, has_hint: Boolean(hint)});
