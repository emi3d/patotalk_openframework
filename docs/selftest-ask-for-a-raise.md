# Self-test: Ask for a raise (en)

**Mr. Sterling:** Sit down, please. We are here to talk about your performance review, but let us keep this quick. What do you have to say?

**Learner (Employee):** Hello, thank you for meeting me. I think I am doing a very good job this year and maybe it is time for a better salary, you know?

**Mr. Sterling:** Hard work is normal, not special. Tell me exact numbers, like sales or money saved, because feelings do not pay the bills.

**Learner (Employee):** Oh, I understand. In the last six months, I bring in three new big clients and this make 20,000 extra for the company.

**Mr. Sterling:** You brought in three new clients and generated twenty thousand dollars in extra revenue for the company. That is a concrete result, and I am glad to see those numbers on the table. Let us discuss the details of your raise now.

**Learner (Employee):** Thank you! Also, I cut the production costs by 15 percent when I organize the new schedule last month.

**Mr. Sterling:** You reduced production costs by fifteen percent by organizing the new schedule last month. Those are impressive numbers, and I appreciate your focus on results. We can definitely approve this raise for you.

**Learner (Employee):** Oh, thank you very much! I am very happy because I work so hard for this company.

**Mr. Sterling:** You work very hard for this company, and your numbers prove your value. I will sign the paperwork for your raise today.

## Evaluation

```json
{
  "criteria": [
    {
      "id": "evidence",
      "score": 5,
      "comment": "Provided specific numbers, bringing in three new clients for 20,000 extra and cutting costs by 15 percent."
    },
    {
      "id": "clarity",
      "score": 5,
      "comment": "Asked for a better salary clearly and directly at the start of the meeting."
    },
    {
      "id": "language",
      "score": 4,
      "comment": "Used appropriate B1 vocabulary, though there were minor tense and agreement errors."
    },
    {
      "id": "confidence",
      "score": 5,
      "comment": "Maintained a polite yet confident tone and successfully handled the boss's demand for numbers."
    }
  ],
  "score": 0.95,
  "passed": true,
  "goalReached": true,
  "feedback": "¡Excelente trabajo! Lograste convencer a tu jefe proporcionando números concretos y resultados medibles sobre tus ventas y el ahorro de costos. Tu nivel de inglés es adecuado para B1, solo presta atención a la gramática y los tiempos verbales en el pasado.",
  "corrections": [
    {
      "original": "In the last six months, I bring in three new big clients and this make 20,000 extra for the company.",
      "better": "In the last six months, I brought in three new big clients and this made 20,000 extra for the company."
    },
    {
      "original": "I cut the production costs by 15 percent when I organize the new schedule last month.",
      "better": "I cut production costs by 15 percent when I organized the new schedule last month."
    }
  ]
}
```

## Stats (SQLite)

```json
{
  "userId": "selftest",
  "attempts": 1,
  "completed": 1,
  "passed": 1,
  "averageScore": 0.95,
  "totalTurns": 4,
  "totalWords": 88,
  "streakDays": 1,
  "byLanguage": {
    "en": {
      "attempts": 1,
      "averageScore": 0.95
    }
  },
  "byExperience": {
    "ask-for-a-raise": {
      "attempts": 1,
      "bestScore": 0.95,
      "passed": true
    }
  }
}
```

Took 20.3 s.