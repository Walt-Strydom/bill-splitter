Below is a complete project plan. 

- Create the application and provide a downloadable zip file
- Create JSON files for each n8n workflow and ensure you align with n8n version 2.9.0

Markdown
Copy code
# Bill Splitter (ZAR) Mobile Web App  
## Project Plan

A mobile-first Progressive Web App that allows a group to split a restaurant bill directly from a receipt photo.

Hosted on your Rocky 8 Linux server.

Postgres stores all party, item, selection and closure data.

n8n handles:

- Google login verification  
- Receipt OCR and parsing  
- Party validation  
- Payment validation  
- Guest closure  
- Analytics updates  

All currency is ZAR only.

---

## Core System Principles

### Receipt is the Single Source of Truth

Each payable value must be calculated strictly from:

- the item name  
- the item price shown on the receipt  

Users cannot:

- edit item prices  
- edit subtotal  
- edit total bill value  
- add new payable items  

Only the following values may be changed:

- quantity a user claims for each item  
- optional party tip percentage  

---

## Party Totals

From OCR extracted receipt items:
party_subtotal_cents = Σ(unit_price_cents * total_quantity)
Copy code

Optional:
tip_percent
Copy code


party_tip_cents = round(party_subtotal_cents * tip_percent / 100)
Copy code


party_total_cents = party_subtotal_cents + party_tip_cents
Copy code

---

## Item Ownership Model

Each item begins inside:

UNCLAIMED ITEM BUCKET

Example receipt:

Pizza ........ R120.00  
Beer ......... R45.00 x2  

Stored:

Pizza  
- unit_price_cents = 12000  
- total_quantity = 1  

Beer  
- unit_price_cents = 4500  
- total_quantity = 2  

Initial bucket:

Pizza x1  
Beer x2  

Users must claim quantities.

---

### Bucket Empty Rule

For every item:
Σ(all_guest_claimed_quantity)
= item.total_quantity
Copy code

If ANY item still has:
remaining_quantity > 0
Copy code

Then:
bucket_empty = false
Copy code

---

## Global Party Validation

The system must constantly check:

### Rule 1: Bucket Must Be Empty

All items must be claimed.

### Rule 2: Subtotal Must Be Fully Covered
Σ(all_guest_subtotals)
= party_subtotal_cents
Copy code

If this is not true:

Some receipt items remain unpaid.

---

## UI Enforcement

Until BOTH:

- bucket_empty = true  
- subtotal_match = true  

The following must be disabled (greyed out):

- ALL users' “I’ve paid” buttons  
- Host “Close Party” button  

Users must see:

- Remaining unclaimed items  
- Remaining unclaimed value in ZAR  

Example:

Unclaimed:  
Fries x1 (R30.00)  
Coke x1 (R25.00)  

Remaining:  
R55.00  

---

## Guest Totals

Each guest subtotal:
guest_subtotal = Σ(unit_price_cents * claimed_qty)
Copy code

Guest tip share:
guest_tip = round( (guest_subtotal / party_subtotal) * party_tip_cents )
Copy code

Guest total due:
guest_total_due = guest_subtotal + guest_tip
Copy code

---

## Payment Enforcement

Each guest must:

Enter:
amount_paid_cents
Copy code

“I’ve paid” button enabled ONLY if:

- bucket_empty = true  
- subtotal_match = true  
- amount_paid_cents >= guest_total_due  

Guest may:

- pay exact  
- overpay  

Guest may NOT:

- underpay  

Once guest closes:

- selections locked  
- payment locked  
- guest.status = closed  

---

## Party Closure

Host may close party ONLY if:

ALL guests.status = closed  

This ensures:

Host will never be left covering unpaid balance.

---

## Authentication

### Google Login

Users may:

- create persistent profile  
- join parties across sessions  
- view billing history  
- view restaurants visited  
- view people they shared bills with  

Anonymous users:

- still allowed to join  
- do not receive analytics  

Google OAuth flow:

Frontend:

- Sign in with Google  
- receive ID token  

Backend (n8n):

- verify token  
- create or fetch user  
- return user_id  

---

## User Analytics

Logged in users must be able to view:

### Billing History
- restaurant name  
- total paid (ZAR)  
- party date  

### Top 5 Restaurants
Ordered by:

- visit_count  

### Top 5 People They Split Bills With
Ordered by:

- shared_party_count  

---

## Party ID

Each party must have:

- 6 character uppercase base32 code  

Example:
T9K3WP
Copy code

Generated randomly.

Must be unique.

---

## Postgres Data Model

### users
- id (uuid pk)  
- google_sub (varchar unique)  
- email  
- name  
- picture_url  
- created_at  

---

### parties
- id (uuid pk)  
- party_code (varchar unique)  
- currency default 'ZAR'  
- restaurant_name  
- status enum: active, closed  
- tip_percent  
- created_by_user_id  
- created_at  

---

### guests
- id (uuid pk)  
- party_id  
- user_id nullable  
- display_name  
- role enum: host, guest  
- join_token  
- status enum: active, closed  
- closed_at  
- created_at  

---

### items
- id  
- party_id  
- name  
- unit_price_cents  
- total_quantity  
- created_at  

---

### selections
- id  
- party_id  
- guest_id  
- item_id  
- quantity  
- created_at  

---

### payments
- id  
- party_id  
- guest_id  
- amount_paid_cents  
- created_at  

---

### closures
- id  
- party_id  
- guest_id  
- subtotal_cents  
- tip_cents  
- total_cents  
- paid_cents  
- closed_at  

---

### restaurants
- id  
- name  

---

### user_restaurant_history
- id  
- user_id  
- restaurant_id  
- visit_count  
- last_visit_at  

---

### user_shared_people
- id  
- user_id  
- other_user_id  
- shared_party_count  
- last_shared_at  

---

## Computed Validation View

### party_validation_view

Returns:

- subtotal_required  
- subtotal_claimed  
- bucket_empty  
- subtotal_match  
- party_can_pay  
- remaining_value_cents  

Where:
remaining_quantity = item.total_quantity - Σ(selections.quantity)
Copy code


bucket_empty = ALL items remaining_quantity <= 0
Copy code


subtotal_match = subtotal_claimed >= subtotal_required
Copy code


party_can_pay = bucket_empty AND subtotal_match
Copy code

---

## n8n Workflows

### Create Party
- generate party_code  
- insert party  
- insert host guest  

---

### Join Party
- validate party_code  
- create guest  
- return join_token  

---

### Upload Receipt
- store image  
- OCR receipt  
- parse items  
- insert items  
- compute subtotal  

---

### Party Validation
- compute subtotal_required  
- compute subtotal_claimed  
- compute bucket status  
- return party_can_pay  

---

### Save Selections
- validate join_token  
- upsert item quantity  

---

### Save Payment
- validate join_token  
- insert payment  
- check guest_total_due  

---

### Close Guest
- validate global party rules  
- validate guest payment  
- insert closure  
- mark guest closed  
- update:
  - user_restaurant_history  
  - user_shared_people  

---

## Frontend Behaviour

Poll every 2–3 seconds:
/party/validate
Copy code

Update:

- remaining items  
- remaining value  
- enable or disable:
  - “I’ve paid”  
  - host close  

---

## MVP Acceptance Criteria

- Prices sourced only from receipt  
- Users cannot modify payable values  
- All items must be claimed  
- Claimed subtotal must match receipt subtotal  
- Bucket must be empty  
- Payment must meet or exceed guest total  
- Guests cannot close early  
- Host cannot carry unpaid balance  
- Billing history recorded for logged in users