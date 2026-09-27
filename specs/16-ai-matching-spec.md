# AI Matching Spec — Future / Feature Flag

## Goal

Convert natural-language needs into structured constraints and retrieve/rank providers.

Example:
"高一数学基础薄弱，想找985本科生，每周两次，预算300左右"

Structured request:
```json
{
  "domain": "TUTORING",
  "grade": "HIGH_1",
  "subjects": ["MATH"],
  "level": "FOUNDATION",
  "providerTypes": ["STUDENT_TUTOR"],
  "schoolTier": "985",
  "frequencyPerWeek": 2,
  "maxPriceMinor": 30000
}
```

## Retrieval

Hard filters:
- approved
- active
- capability match
- service match
- availability
- geography/mode if required

Soft ranking:
- exact subject
- grade fit
- experience
- rating count
- price fit
- response/activity

## AI constraints

- AI must not invent credentials.
- AI must not alter verified facts.
- AI recommendations must be explainable using stored provider attributes.
- User can ignore recommendations and search manually.
- Do not infer sensitive personal attributes.
- AI is not the final authority for provider approval, moderation appeal, payment or safety decisions.

## Implementation

V1: deterministic retrieval.
V2: embeddings/reranking behind interface.
V3: LLM query parsing with schema validation.
