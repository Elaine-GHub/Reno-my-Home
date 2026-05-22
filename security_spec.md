# Security Specification: My Home Space Studio

This security specification details the Attribute-Based Access Control (ABAC) boundaries and strict zero-trust invariants designed to secure user data.

## 1. Data Invariants
1. **Access Isolation**: Saved concepts are strictly owned by a unique user `userId` matching their authentic Firebase Authentication UID. No other user must be able to view, list, query, or modify them.
2. **Metadata Integrity (Immortality)**: Fields like `createdAt` and `userId` are immutable after creation.
3. **Strict Validation Shape**: Every creation and modification request must pass structure checks restricting unauthorized fields (averting Ghost Field insertion).
4. **Verified Users Constraint**: Standard write operations require an email-verified authentication token (`request.auth.token.email_verified == true`).

---

## 2. The "Dirty Dozen" Malicious Payloads

The following negative-test payloads aim to compromise user collections or bypass structural controls:

### Payload 1: Identity Spoofing (Save as another User)
```json
{
  "userId": "attacker_uid_999",
  "title": "Malicious Hijack Concept",
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {}
}
```
*Expected: Rejected (userId must match request.auth.uid)*

### Payload 2: Ghost Field Inject (Shadow Update attack)
```json
{
  "userId": "victim_uid_123",
  "title": "Spoofed Minimalist Aesthetic",
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {},
  "isSystemAdminVerified": true
}
```
*Expected: Rejected (Strict keys validation prevents unlisted keys)*

### Payload 3: Creation Temporal Spoofing (Forged offline client clock)
```json
{
  "userId": "victim_uid_123",
  "title": "Ancient Epoch Save",
  "createdAt": "1970-01-01T00:00:00Z",
  "userInput": {},
  "aiResponse": {}
}
```
*Expected: Rejected (createdAt must align with server timestamp request.time)*

### Payload 4: ID Character Poisoning Injection
*Action: Write to document with ID: `/concepts/../../../etc/passwd` or junk buffers*
```json
{
  "userId": "victim_uid_123",
  "title": "ID Poison Test",
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {}
}
```
*Expected: Rejected (Document IDs must match strict regex pattern)^[a-zA-Z0-9_\-]+$*

### Payload 5: Spoofing with unverified email token
```json
{
  "userId": "unverified_user_uid",
  "title": "Unverified Save Attempt",
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {}
}
```
*Expected: Rejected (token.email_verified must be true)*

### Payload 6: Mutate Immortal Fields (createdAt edit)
*Action: Update existing concept changing `createdAt`*
```json
{
  "userId": "victim_uid_123",
  "title": "Updated Title",
  "createdAt": "2030-01-01T00:00:00Z"
}
```
*Expected: Rejected (createdAt cannot be modified)*

### Payload 7: Spoofing Owner ID (Changing userId on update)
*Action: Update concept to transfer ownership field to another user*
```json
{
  "userId": "attacker_uid_999",
  "title": "Stolen Concept"
}
```
*Expected: Rejected (userId must be immutable on update)*

### Payload 8: Value Poisoning (Giant string injection in Title)
```json
{
  "userId": "victim_uid_123",
  "title": "A".repeat(100500),
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {}
}
```
*Expected: Rejected (title length must be checked and <= 256 characters)*

### Payload 9: Empty/Missing Keys Payload
```json
{
  "userId": "victim_uid_123",
  "title": "Incomplete Payload"
}
```
*Expected: Rejected (Mandatory fields: userInput, aiResponse cannot be null)*

### Payload 10: Unauthorized Data Modification (Updating restricted fields)
*Action: Attempting to alter structural components inside userInputs field directly*
```json
{
  "userInput": {
    "totalBudget": -500000
  }
}
```
*Expected: Rejected (Must pass isValid[Concept] check)*

### Payload 11: Reader Query Exhaustion / Scraping without where constraint
*Action: Listing all concepts without specifying owner UID*
```json
{}
```
*Expected: Rejected (Query Enforcer prevents list operations without userId match)*

### Payload 12: Administrative bypass mimicking
```json
{
  "userId": "victim_uid_123",
  "title": "Admin Role Impersonation",
  "createdAt": "2026-05-22T04:00:00Z",
  "userInput": {},
  "aiResponse": {},
  "role": "admin"
}
```
*Expected: Rejected (Administrative claims cannot be set as fields on user models)*

---

## 3. Security Test Specification Draft

Due to local sandboxing, we verify these negative payloads through our secure Firestore schema parser rules. Let's write rules that systematically deny all 12 negative payloads.
