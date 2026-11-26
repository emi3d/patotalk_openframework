# Self-test: ラーメン屋で注文 (ja)

**Tanaka-san:** いらっしゃいませ！なにに しますか？

**Learner (Customer):** あの、お腹がすきました。ラーメンをたべたいですが、どれがいいですか。

**Tanaka-san:** みそラーメンが いちばん おいしいですよ。
みそラーメンにしますか。

**Learner (Customer):** はい、みそラーメンをください。おおきいサイズはありますか。

**Tanaka-san:** はい、おおきいサイズも ありますよ。
おおきいのに しますか。

**Learner (Customer):** はい、おおきいのおねがいします。あと、いくらですか。

**Tanaka-san:** おおきいのみそラーメンですね。
きゅうひゃくえん です。

## Evaluation

```json
{
  "criteria": [
    {
      "id": "order",
      "score": 5,
      "comment": "Has pedido el ramen de miso claramente y has especificado el tamaño grande."
    },
    {
      "id": "politeness",
      "score": 5,
      "comment": "Has usado expresiones muy correctas y naturales como ください y おねがいします."
    },
    {
      "id": "interaction",
      "score": 5,
      "comment": "Has interactuado muy bien preguntando por una recomendación y respondiendo sobre el tamaño."
    }
  ],
  "score": 1,
  "passed": true,
  "goalReached": true,
  "feedback": "¡Muy bien hecho! Has completado todas las tareas de la escena de forma natural y educada para el nivel N5. Tu uso de las estructuras para pedir comida y preguntar el precio ha sido excelente.",
  "corrections": [
    {
      "original": "あの、お腹がすきました。ラーメンをたべたいですが、どれがいいですか。",
      "better": "すみません、ラーメンをたべたいですが、おすすめはどれですか。"
    }
  ]
}
```

## Stats (SQLite)

```json
{
  "userId": "selftest",
  "attempts": 2,
  "completed": 2,
  "passed": 2,
  "averageScore": 0.975,
  "totalTurns": 7,
  "totalWords": 166,
  "streakDays": 1,
  "byLanguage": {
    "ja": {
      "attempts": 1,
      "averageScore": 1
    },
    "en": {
      "attempts": 1,
      "averageScore": 0.95
    }
  },
  "byExperience": {
    "ja-ramen-order": {
      "attempts": 1,
      "bestScore": 1,
      "passed": true
    },
    "ask-for-a-raise": {
      "attempts": 1,
      "bestScore": 0.95,
      "passed": true
    }
  }
}
```

Took 6.7 s.