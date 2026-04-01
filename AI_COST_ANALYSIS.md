# ChatBridge — AI Cost Analysis

**Date:** April 2026
**Model:** OpenAI GPT-4o-mini (primary), GPT-4o (intent classification)
**Pricing basis:** OpenAI API pricing as of April 2026

---

## Development Costs (Actual)

| Phase                    | OpenAI Calls | Est. Tokens     | Cost      |
| ------------------------ | ------------ | --------------- | --------- |
| Phase 1 — Scaffolding    | ~50 calls    | ~100K tokens    | ~$0.15    |
| Phase 2 — Plugin system  | ~150 calls   | ~400K tokens    | ~$0.60    |
| Phase 3 — 3 more apps    | ~100 calls   | ~250K tokens    | ~$0.38    |
| Phase 4 — Polish/testing | ~75 calls    | ~150K tokens    | ~$0.23    |
| **Total Dev Cost**       |              | **~900K tokens**| **~$1.36**|

*Note: Most development cost is Claude API (via Gauntlet AI tooling), not OpenAI. The above reflects only backend OpenAI calls made during testing.*

---

## Runtime Cost Model

### Per-Conversation Breakdown

ChatBridge uses a **two-phase routing architecture** to minimize token usage:

| Step                  | Model         | Tokens (avg) | Cost/call     |
| --------------------- | ------------- | ------------ | ------------- |
| Intent classification | GPT-4o-mini   | ~300         | $0.000045     |
| Chat response (no app)| GPT-4o-mini   | ~800 in/out  | $0.000120     |
| Chat + tool (w/ app)  | GPT-4o-mini   | ~1,400 in/out| $0.000210     |
| Tool schema injection | (cached)      | ~400 (saved) | savings only  |

**Key optimization:** Schema injection only for matched app (~400 tokens saved per non-matched conversation vs. injecting all schemas upfront).

**Average conversation cost: ~$0.00015 – $0.00025**

---

## Scale Projections

### Assumptions
- Average session = 8 messages
- 40% of sessions involve app tool calls (avg 2 tool calls per session)
- GPT-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens

| Scale              | Daily Users | Daily Conversations | Monthly Cost    | Monthly Cost (w/ 20% buffer) |
| ------------------ | ----------- | ------------------- | --------------- | ----------------------------- |
| **MVP / Demo**     | 100         | 200                 | ~$1             | ~$1.20                        |
| **Early Traction** | 1,000       | 2,000               | ~$9             | ~$11                          |
| **TutorMeAI Now**  | 200,000     | 400,000             | ~$1,800         | ~$2,160                       |
| **TutorMeAI 10x**  | 2,000,000   | 4,000,000           | ~$18,000        | ~$21,600                      |

### TutorMeAI Scale (200K DAU) — Monthly Breakdown

| Cost Category          | Monthly        | Notes                                              |
| ---------------------- | -------------- | -------------------------------------------------- |
| OpenAI GPT-4o-mini     | ~$1,800        | 400K conversations × ~$0.0045 avg                 |
| Supabase               | ~$25           | Pro plan (needed at this scale for no auto-pause)  |
| Vercel                 | ~$20           | Pro plan for bandwidth + builds                    |
| Railway                | ~$20           | Starter plan, auto-scale                           |
| **Total**              | **~$1,865/mo** | **~$0.0093 per user per month**                    |

### Optimization Levers (if needed at scale)

| Strategy                     | Savings Potential | Implementation Effort |
| ----------------------------- | ----------------- | --------------------- |
| Cache intent classification   | 15–20%            | Low — Redis TTL cache |
| Prompt caching (OpenAI)       | Up to 50%         | Medium — prefix cache |
| Reduce max_tokens to 512      | 20–30%            | Low — config change   |
| Use fine-tuned classifier     | 30% on intent     | High — training data  |
| Conversation summarization    | 25% on long convs | Medium — summarize >10 msgs |

---

## Token Budget Architecture

### Current System Prompt Size
- Base system prompt: ~150 tokens
- App-specific addendum: ~50 tokens
- **Total per request: ~200 tokens** (fixed overhead)

### History Window
- Max 50 messages loaded per conversation
- Average message: ~80 tokens
- Max history cost: ~4,000 tokens (rarely hit in practice)

### Tool Schema Injection
- Without two-phase routing: ~600 tokens (all 4 app schemas)
- With two-phase routing: ~150 tokens (matched app only)
- **Savings: ~450 tokens per matched conversation** (~$0.000068 each)

At 200K DAU with 40% tool usage: **~$3,264/month saved** from two-phase routing alone.

---

## Infrastructure Cost Comparison

### Current Architecture vs Alternatives

| Architecture                       | Monthly (200K DAU) | Pros                    | Cons                       |
| ---------------------------------- | ------------------ | ----------------------- | -------------------------- |
| **Current** (Vercel + Railway + Supabase) | ~$65          | Simple, fast deploy     | Railway cold starts        |
| AWS (EC2 + RDS + CloudFront)       | ~$180              | Full control            | Ops complexity             |
| GCP Cloud Run + AlloyDB            | ~$120              | Auto-scale, managed     | GCP lock-in                |
| Self-hosted VPS (Hetzner)          | ~$30               | Cheapest                | Manual ops, no auto-scale  |

**Recommendation:** Current architecture is optimal for MVP. Migrate backend to AWS ECS or GCP Cloud Run at 500K+ DAU.

---

## Break-even Analysis

Assuming ChatBridge is offered as a platform feature within TutorMeAI:

- TutorMeAI subscription: ~$12/user/month (estimated)
- AI cost per user: ~$0.009/month
- **AI cost as % of revenue: 0.075%** — well within acceptable range

Even at 10x scale ($21,600/month), this represents less than 0.1% of projected revenue at 2M DAU.
