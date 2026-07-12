"""Signal-to-Action Agent POC skills package.

Each module in this package implements exactly one skill from the
Sources -> Triage -> AI Evaluation -> Action Fanout -> Audit spine
described in ../ARCHITECTURE.md.

Read-only skills (must never write files or send messages):
    - ingest_transcript
    - detect_painpoint
    - lookup_account
    - evaluate_intent
    - lookup_specialist

Write/notify skill (the only skill allowed to write files or simulate a send):
    - notify
"""
