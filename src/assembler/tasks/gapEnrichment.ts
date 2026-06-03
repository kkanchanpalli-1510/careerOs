import { CareerStage } from '../summary';

export interface Question {
  num: string;
  text: string;
  why: string;
}

export const STAGE_QUESTIONS: Record<CareerStage, Question[]> = {

  ic: [
    {
      num: 'Question 1 of 4',
      text: 'Tell me about something significant you built or changed that nobody asked you to.',
      why: 'Resumes document assignments. This surfaces your initiative pattern — the decisions you made before anyone knew they needed to be made.',
    },
    {
      num: 'Question 2 of 4',
      text: "What's the hardest technical problem you've solved — not just technically hard, but one where you had to invent the approach because no playbook existed?",
      why: "This surfaces your deepest capability signal — the problems only you could solve in the way you solved them. It's the most differentiated thing about you.",
    },
    {
      num: 'Question 3 of 4',
      text: 'Which parts of your work made you lose track of time — and which felt like a tax you paid to get to the interesting parts?',
      why: "This tells us which capabilities are growing edges and which are terminal — what you'll keep developing vs. executing out of obligation. It determines which directions are actually reachable for you.",
    },
    {
      num: 'Question 4 of 4',
      text: "What's something you understand about your technical domain that most people in your field don't — a mental model or pattern others seem to miss?",
      why: "This surfaces your rarest signal: the insight that only comes from deep craft. It's almost never on a resume and almost always at the heart of what makes you exceptional.",
    },
  ],

  leader: [
    {
      num: 'Question 1 of 4',
      text: 'Tell me about something significant you built or changed that nobody asked you to.',
      why: 'Resumes document assignments. This surfaces your initiative pattern — the decisions you made before anyone knew they needed to be made.',
    },
    {
      num: 'Question 2 of 4',
      text: 'Tell me about something you built — a team, a capability, a system, a culture — that continued to create value after you moved on from it.',
      why: "This surfaces your multiplier signal — the things you built that outlasted your direct involvement. It's the clearest evidence of leverage, and it's almost never captured in a resume.",
    },
    {
      num: 'Question 3 of 4',
      text: 'Which parts of your work in the last two years energized you — and which parts did you do because they needed to be done but someone else would probably love them?',
      why: "At your level, energy signal determines which direction is sustainable. Where you have energy, you create leverage. Where you don't, you just manage.",
    },
    {
      num: 'Question 4 of 4',
      text: "What's the hardest organizational decision you've made — not technically hard, but one where you had to choose between two things that both mattered?",
      why: 'This surfaces your decision architecture — the values and judgment underneath your trajectory. It\'s the most revealing thing about how you operate under constraint.',
    },
  ],

  executive: [
    {
      num: 'Question 1 of 4',
      text: 'Tell me about a bet you made — strategic, architectural, organizational — before you had proof it was right.',
      why: "Executive-level insight comes from the bets made before they were obvious. This is the highest-signal question for your career stage — it surfaces conviction and judgment, not just execution.",
    },
    {
      num: 'Question 2 of 4',
      text: "What do people come to you for that they don't go to anyone else in your organization — the judgment call, the framing, the read on a situation?",
      why: "This surfaces your rarest organizational capability — the thing you've become known for that exists nowhere in your job description. At your level, this is your true differentiation.",
    },
    {
      num: 'Question 3 of 4',
      text: 'Looking at the last two years — where did you create the most organizational leverage, and where did you find yourself doing work that should have been delegated or eliminated?',
      why: 'For executives, energy and leverage signal what your next role should look like. Where you create leverage without draining energy is where your highest-value future sits.',
    },
    {
      num: 'Question 4 of 4',
      text: "What's the decision you made in your career that most people wouldn't have made — and that you still believe was right even if it was costly?",
      why: "This is the decision that reveals your values, your risk tolerance, and the quality of your judgment under pressure. It's almost always the most defining moment in the career and almost never on the resume.",
    },
  ],
};
