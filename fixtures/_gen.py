#!/usr/bin/env python3
"""Regenerates every fixture under fixtures/. Run: python3 fixtures/_gen.py
Single source of truth for dates/IDs so all systems stay consistent.
Today = 2026-09-13T12:00:00Z. Dispute created = today-2d, due_by = today+5d (23:59:59Z)."""
import base64, json, os
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
NOW = datetime(2026, 9, 13, 12, 0, 0, tzinfo=timezone.utc)
MERCHANT = {"name": "Juniper & Pine Outfitters", "email": "support@juniperpine.example", "domain": "juniperpine.example"}
APPROVAL_THRESHOLD_CENTS = 20000
API_VERSION = "2026-08-26"  # UNVERIFIED value; envelope shape verified


def ts(d): return int(d.timestamp())
def days(n, h=0): return NOW + timedelta(days=n, hours=h)
def eod(n): return (NOW + timedelta(days=n)).replace(hour=23, minute=59, second=59)
def iso_sf(d): return d.strftime("%Y-%m-%dT%H:%M:%S.000+0000")
def b64url(s): return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def write(rel, obj):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


EVIDENCE_KEYS = ["access_activity_log", "billing_address", "cancellation_policy", "cancellation_policy_disclosure",
                 "cancellation_rebuttal", "customer_communication", "customer_email_address", "customer_name",
                 "customer_purchase_ip", "customer_signature", "duplicate_charge_documentation",
                 "duplicate_charge_explanation", "duplicate_charge_id", "product_description", "receipt",
                 "refund_policy", "refund_policy_disclosure", "refund_refusal_explanation", "service_date",
                 "service_documentation", "shipping_address", "shipping_carrier", "shipping_date",
                 "shipping_documentation", "shipping_tracking_number", "uncategorized_file", "uncategorized_text"]
NETWORK_CODE = {"product_not_received": "13.1", "subscription_canceled": "13.2", "fraudulent": "10.4",
                "credit_not_processed": "13.6", "product_unacceptable": "13.3", "duplicate": "12.6.1", "general": "13.7"}


def dispute(n, cust, amount, reason, status="needs_response", created=None, due=None, evidence=None,
            submission_count=0, has_evidence=False, past_due=False, refundable=True):
    created = created or days(-2)
    due = due or eod(5)
    ev = {k: None for k in EVIDENCE_KEYS}
    ev.update(evidence or {})
    return {
        "id": f"du_1Snt{n}Dispute0000000", "object": "dispute", "amount": amount,
        "balance_transactions": [] if status.startswith("warning") else [{"id": f"txn_1Snt{n}Withdraw00000", "object": "balance_transaction", "amount": -amount, "currency": "usd", "fee": 1500, "reporting_category": "dispute", "type": "adjustment"}],
        "charge": f"ch_1Snt{n}Charge00000000", "created": ts(created), "currency": "usd",
        "enhanced_eligibility_types": [], "evidence": ev,
        "evidence_details": {"due_by": ts(due), "has_evidence": has_evidence, "past_due": past_due, "submission_count": submission_count},
        "is_charge_refundable": refundable, "livemode": False, "metadata": {},
        "payment_intent": f"pi_1Snt{n}Intent00000000",
        "payment_method_details": {"type": "card", "card": {"brand": "visa", "case_type": "inquiry" if status.startswith("warning") else "chargeback", "network_reason_code": NETWORK_CODE.get(reason, "13.7")}},
        "reason": reason, "status": status,
    }


def charge(n, cust, amount, desc, created=None, refunded=0):
    c = cust
    addr = {"city": "Portland", "country": "US", "line1": c["line1"], "line2": None, "postal_code": "97214", "state": "OR"}
    return {
        "id": f"ch_1Snt{n}Charge00000000", "object": "charge", "amount": amount, "amount_captured": amount,
        "amount_refunded": refunded, "balance_transaction": f"txn_1Snt{n}Charge000000",
        "billing_details": {"address": addr, "email": c["email"], "name": c["name"], "phone": None},
        "created": ts(created or days(-20)), "currency": "usd", "customer": c["id"], "description": desc,
        "disputed": True, "livemode": False, "metadata": {"order_id": c["order"]},
        "outcome": {"network_status": "approved_by_network", "reason": None, "risk_level": "normal", "risk_score": 23, "seller_message": "Payment complete.", "type": "authorized"},
        "paid": True, "payment_intent": f"pi_1Snt{n}Intent00000000", "payment_method": f"pm_1Snt{n}Card000000000",
        "payment_method_details": {"card": {"brand": "visa", "checks": {"address_line1_check": "pass", "address_postal_code_check": "pass", "cvc_check": "pass"}, "country": "US", "exp_month": 12, "exp_year": 2028, "last4": "0259", "network": "visa"}, "type": "card"},
        "receipt_email": c["email"], "refunded": refunded >= amount and refunded > 0,
        "shipping": {"address": addr, "carrier": "UPS", "name": c["name"], "phone": None, "tracking_number": c.get("tracking")},
        "status": "succeeded",
    }


def customer(c, created_days=-400):
    return {"id": c["id"], "object": "customer", "address": None, "created": ts(days(created_days)), "description": None,
            "email": c["email"], "livemode": False, "metadata": {"sf_contact_id": c["sf"]}, "name": c["name"], "phone": None}


def refund(n, ch, amount, created, reason="requested_by_customer", status="succeeded"):
    return {"id": f"re_1Snt{n}Refund00000000", "object": "refund", "amount": amount, "charge": ch,
            "created": ts(created), "currency": "usd", "metadata": {}, "payment_intent": ch.replace("ch_", "pi_").replace("Charge", "Intent"),
            "reason": reason, "status": status}


def lst(url, data): return {"object": "list", "data": data, "has_more": False, "url": url}


def event(n, typ, obj, prev=None, created=None):
    data = {"object": obj}
    if prev is not None:
        data["previous_attributes"] = prev
    return {"id": f"evt_1Snt{n}{typ.split('.')[-1][:6]}0000", "object": "event", "api_version": API_VERSION,
            "created": created or obj["created"], "data": data, "livemode": False, "pending_webhooks": 1,
            "request": {"id": None, "idempotency_key": None}, "type": typ}


# ---------- Salesforce ----------
def sf_contact(c, ltv, prior=0, flag=None):
    desc = f"LTV_CENTS: {ltv}\nPRIOR_DISPUTES_90D: {prior}\nRISK_FLAG: {flag or 'none'}"
    return {"attributes": {"type": "Contact", "url": f"/services/data/v62.0/sobjects/Contact/{c['sf']}"},
            "Id": c["sf"], "FirstName": c["name"].split()[0], "LastName": c["name"].split()[1], "Name": c["name"],
            "Email": c["email"], "Description": desc, "MailingCity": "Portland", "MailingState": "OR",
            "CreatedDate": iso_sf(days(-400)), "LastModifiedDate": iso_sf(days(-20))}


def sf_case(c, idx, subject, desc, typ="Other", status="Closed", created=None, reason="Other"):
    cid = c["sf"].replace("003", "500")[:-3] + f"C{idx}A"
    return {"attributes": {"type": "Case", "url": f"/services/data/v62.0/sobjects/Case/{cid}"},
            "Id": cid, "CaseNumber": f"0000{1040 + idx + int(c['n']) * 10}", "ContactId": c["sf"], "Subject": subject,
            "Description": desc, "Status": status, "Origin": "Web", "Type": typ, "Reason": reason, "Priority": "Medium",
            "CreatedDate": iso_sf(created or days(-19))}


def sf_query(records): return {"totalSize": len(records), "done": True, "records": records}


# ---------- Gmail ----------
def gmsg(mid, tid, frm, to, subject, body, when, labels):
    return {"id": mid, "threadId": tid, "labelIds": labels, "snippet": body[:90].replace("\n", " "),
            "historyId": str(880000 + int(mid[-2:], 16)), "internalDate": str(ts(when) * 1000), "sizeEstimate": 1800 + len(body),
            "payload": {"partId": "", "mimeType": "multipart/alternative", "filename": "",
                        "headers": [{"name": "From", "value": frm}, {"name": "To", "value": to}, {"name": "Subject", "value": subject},
                                    {"name": "Date", "value": when.strftime("%a, %d %b %Y %H:%M:%S +0000")},
                                    {"name": "Message-ID", "value": f"<{mid}@mail.example>"}],
                        "body": {"size": 0},
                        "parts": [{"partId": "0", "mimeType": "text/plain", "filename": "", "headers": [{"name": "Content-Type", "value": "text/plain; charset=\"UTF-8\""}], "body": {"size": len(body), "data": b64url(body)}},
                                  {"partId": "1", "mimeType": "text/html", "filename": "", "headers": [{"name": "Content-Type", "value": "text/html; charset=\"UTF-8\""}], "body": {"size": len(body) + 11, "data": b64url("<div>" + body.replace("\n", "<br>") + "</div>")}}]}}


def gthread(tid, msgs): return {"id": tid, "historyId": msgs[-1]["historyId"], "messages": msgs}


def fmt(c): return f"{c['name']} <{c['email']}>"
MER = f"{MERCHANT['name']} <{MERCHANT['email']}>"


def receipt_thread(c, n, delivered, confirm):
    tid = f"18f{n}a0c3e1b2d4{n}0"[:16]
    return gthread(tid, [
        gmsg(tid[:14] + "01", tid, MER, fmt(c), f"Your order {c['order']} has shipped", f"Hi {c['name'].split()[0]},\nYour order {c['order']} shipped via UPS, tracking {c['tracking']}.\n- {MERCHANT['name']}", delivered - timedelta(days=4), ["SENT"]),
        gmsg(tid[:14] + "02", tid, fmt(c), MER, f"Re: Your order {c['order']} has shipped", f"Got it, thanks! The {c['item']} arrived today and fits great.\n{c['name'].split()[0]}", confirm, ["INBOX", "CATEGORY_PERSONAL"]),
    ])


def cancel_thread(c, n, cancel_when, charge_when):
    tid = f"18f{n}b7d9e2c4a6{n}0"[:16]
    return gthread(tid, [
        gmsg(tid[:14] + "01", tid, fmt(c), MER, "Please cancel my subscription", f"Hello,\nPlease cancel my {c['item']} subscription effective immediately. Do not charge me for the next cycle ({charge_when.strftime('%B %d')}).\nThanks, {c['name'].split()[0]}", cancel_when, ["INBOX"]),
        gmsg(tid[:14] + "02", tid, MER, fmt(c), "Re: Please cancel my subscription", "Thanks for reaching out - we've received your cancellation request.\n- Support", cancel_when + timedelta(hours=3), ["SENT"]),
    ])


# ---------- Customers per scenario ----------
PEOPLE = [
    ("01", "Riley Tanaka", "Merino trail jacket", 8900, "product_not_received"),
    ("02", "Jordan Alvarez", "Canvas daypack", 14500, "product_not_received"),
    ("03", "Priya Natarajan", "Coffee club subscription", 4900, "subscription_canceled"),
    ("04", "Sam Whitfield", "Gear box annual subscription", 34000, "subscription_canceled"),
    ("05", "Casey Morgan", "Down sleeping bag", 12000, "product_not_received"),
    ("06", "Devon Park", "Wool beanie 3-pack", 7500, "product_not_received"),
    ("07", "Alex Rivera", "Insulated water bottle set", 9600, "product_not_received"),
    ("08", "Taylor Brooks", "Hiking boots", 16900, "product_not_received"),
]


def person(n, name, item):
    first, last = name.lower().split()
    return {"n": n, "name": name, "item": item, "email": f"{first}.{last}@example.com", "id": f"cus_Snt{n}Customer0",
            "sf": f"003Hs00000Snt{n}AAA", "order": f"JP-104{n}", "tracking": f"1Z999AA1012345{n}78", "line1": f"{int(n) * 111} SE Alder St"}


def build_scenario(n, name, item, amount, reason):
    c = person(n, name, item)
    ch = charge(n, c, amount, f"Order {c['order']}: {item}")
    d = dispute(n, c, amount, reason)
    seed = {"stripe": {"customer": customer(c), "charge": ch, "dispute": d, "refunds": lst("/v1/refunds", []), "prior_disputes": lst("/v1/disputes", [])},
            "salesforce": {"contact": sf_contact(c, amount * 3), "cases": sf_query([])}, "gmail": {"threads": []}}
    return c, seed


def main():
    # ---------- Tier 1 Stripe canonical fixtures (scenario 01 customer) ----------
    c1 = person("01", "Riley Tanaka", "Merino trail jacket")
    ch1 = charge("01", c1, 8900, "Order JP-10401: Merino trail jacket")
    d1 = dispute("01", c1, 8900, "product_not_received")
    write("stripe/dispute.needs_response.json", d1)
    ev_sub = {"customer_email_address": c1["email"], "customer_name": c1["name"], "product_description": "Merino trail jacket, size M, order JP-10401",
              "shipping_address": "111 SE Alder St, Portland, OR 97214, US", "shipping_carrier": "UPS", "shipping_date": days(-18).strftime("%Y-%m-%d"),
              "shipping_tracking_number": c1["tracking"], "uncategorized_text": "UPS tracking 1Z999AA101234501 shows delivery to the cardholder's billing/shipping address. The customer replied by email confirming receipt (quoted below)."}
    d_ur = dispute("01", c1, 8900, "product_not_received", status="under_review", evidence=ev_sub, submission_count=1, has_evidence=True, refundable=False)
    write("stripe/dispute.under_review.json", d_ur)
    write("stripe/dispute.warning_needs_response.json", dispute("01", c1, 8900, "general", status="warning_needs_response"))
    write("stripe/charge.json", ch1)
    write("stripe/customer.json", customer(c1))
    write("stripe/refund.json", refund("01", ch1["id"], 8900, days(-1)))
    write("stripe/event.charge.dispute.created.json", event("01", "charge.dispute.created", d1))
    write("stripe/event.charge.dispute.updated.json", event("01", "charge.dispute.updated", d_ur,
          prev={"evidence": {k: None for k in ev_sub}, "evidence_details": {"has_evidence": False, "submission_count": 0}, "is_charge_refundable": True, "status": "needs_response"}, created=ts(days(0))))
    c5 = person("05", "Casey Morgan", "Down sleeping bag")
    write("stripe/dispute.list.json", lst("/v1/disputes", [
        dispute("05a", c5, 6400, "product_not_received", status="lost", created=days(-70), due=days(-62), past_due=True, refundable=False),
        dispute("05b", c5, 5200, "fraudulent", status="lost", created=days(-35), due=days(-27), past_due=True, refundable=False)]))
    write("stripe/dispute.update.request.json", {"evidence": ev_sub, "metadata": {"sentinel_case": d1["id"], "sentinel_attempt": "1"}, "submit": True})
    write("stripe/dispute.close.response.json", dispute("01", c1, 8900, "product_not_received", status="lost", refundable=False))

    # ---------- Salesforce ----------
    con1 = sf_contact(c1, 48200)
    case_del = sf_case(c1, 1, "Order JP-10401 delivered", f"ORDER: JP-10401\nITEM: Merino trail jacket\nCARRIER: UPS\nTRACKING: {c1['tracking']}\nSHIPPED: {days(-18).date()}\nDELIVERED: {days(-14).date()}\nSIGNATURE: none (left at front door, photo on file)", created=days(-18))
    c3 = person("03", "Priya Natarajan", "Coffee club subscription")
    case_can = sf_case(c3, 1, "Subscription cancellation request", f"Customer emailed cancellation on {days(-12).date()} before renewal charge on {days(-9).date()}. Cancellation not processed in billing (agent error).", status="Closed", created=days(-12))
    write("salesforce/contact.json", con1)
    write("salesforce/case.delivery.json", case_del)
    write("salesforce/case.cancellation.json", case_can)
    write("salesforce/query.contacts.json", sf_query([con1]))
    write("salesforce/query.cases.json", sf_query([case_del]))
    write("salesforce/patch.contact.request.json", {"Description": "LTV_CENTS: 58400\nPRIOR_DISPUTES_90D: 2\nRISK_FLAG: friendly_fraud"})
    write("salesforce/create.case.request.json", {"ContactId": c5["sf"], "Subject": "Chargeback risk: repeat disputer", "Description": "Dispute du_1Snt05Dispute0000000 (product_not_received, $120.00). 2 prior disputes in 90 days. Delivery confirmed by UPS. Evidence submitted.", "Status": "New", "Origin": "Web", "Type": "Other", "Priority": "High"})
    write("salesforce/create.response.json", {"id": "500Hs00000Snt05C9A", "success": True, "errors": []})
    write("salesforce/error.response.json", [{"message": "No such column 'Risk_Flag__c' on entity 'Contact'.", "errorCode": "INVALID_FIELD"}])

    # ---------- Gmail ----------
    rt = receipt_thread(c1, "1", days(-14), days(-5))
    write("gmail/thread.receipt_confirmed.json", rt)
    ct = cancel_thread(c3, "3", days(-12), days(-9))
    write("gmail/thread.cancellation.json", ct)
    write("gmail/messages.list.json", {"messages": [{"id": m["id"], "threadId": m["threadId"]} for m in rt["messages"]], "resultSizeEstimate": 2})
    write("gmail/threads.list.json", {"threads": [{"id": rt["id"], "snippet": rt["messages"][-1]["snippet"], "historyId": rt["historyId"]}], "resultSizeEstimate": 1})
    write("gmail/messages.list.empty.json", {"resultSizeEstimate": 0})

    # ---------- Slack ----------
    blocks = [{"type": "section", "block_id": "summary", "text": {"type": "mrkdwn", "text": "*Approval needed: accept dispute* `du_1Snt04Dispute0000000`\nCustomer: Sam Whitfield (sam.whitfield@example.com)\nAmount: *$340.00* (over $200.00 threshold) - reason `subscription_canceled`\nEvidence: customer emailed cancellation before renewal charge.\nDue: " + eod(5).strftime("%Y-%m-%d %H:%M UTC")}},
              {"type": "actions", "block_id": "approval", "elements": [
                  {"type": "button", "action_id": "approve_accept", "text": {"type": "plain_text", "text": "Approve accept"}, "style": "primary", "value": "du_1Snt04Dispute0000000"},
                  {"type": "button", "action_id": "reject_accept", "text": {"type": "plain_text", "text": "Reject"}, "style": "danger", "value": "du_1Snt04Dispute0000000"}]}]
    write("slack/postMessage.approval.request.json", {"channel": "C0SNTAPPRV1", "text": "Approval needed: accept dispute du_1Snt04Dispute0000000 ($340.00)", "blocks": blocks, "unfurl_links": False})
    post_ts = f"{ts(NOW)}.000100"
    msg = {"type": "message", "subtype": "bot_message", "text": "Approval needed: accept dispute du_1Snt04Dispute0000000 ($340.00)", "ts": post_ts, "bot_id": "B0SNTBOT01", "username": "Sentinel", "blocks": blocks}
    write("slack/postMessage.response.json", {"ok": True, "channel": "C0SNTAPPRV1", "ts": post_ts, "message": msg})
    write("slack/history.response.json", {"ok": True, "messages": [msg], "has_more": False, "pin_count": 0, "response_metadata": {"next_cursor": ""}})
    write("slack/error.response.json", {"ok": False, "error": "channel_not_found"})
    write("slack/block_actions.payload.json", {"type": "block_actions", "user": {"id": "U0SNTOPS01", "username": "ops.lead", "name": "ops.lead", "team_id": "T0SNTTEAM1"}, "api_app_id": "A0SNTAPP01", "token": "UNVERIFIED-legacy-verification-token", "container": {"type": "message", "message_ts": post_ts, "channel_id": "C0SNTAPPRV1", "is_ephemeral": False}, "trigger_id": "123.456.abc", "team": {"id": "T0SNTTEAM1", "domain": "juniperpine"}, "channel": {"id": "C0SNTAPPRV1", "name": "dispute-approvals"}, "message": msg, "response_url": "https://hooks.slack.com/actions/T0SNTTEAM1/1/abc", "actions": [{"action_id": "approve_accept", "block_id": "approval", "text": {"type": "plain_text", "text": "Approve accept", "emoji": True}, "value": "du_1Snt04Dispute0000000", "style": "primary", "type": "button", "action_ts": f"{ts(NOW) + 60}.000200"}]})
    write("slack/conversations.list.response.json", {"ok": True, "channels": [{"id": "C0SNTDISP01", "name": "disputes", "is_channel": True, "is_member": True}, {"id": "C0SNTAPPRV1", "name": "dispute-approvals", "is_channel": True, "is_member": True}, {"id": "C0SNTRISK01", "name": "risk", "is_channel": True, "is_member": True}], "response_metadata": {"next_cursor": ""}})

    # ---------- Scenarios ----------
    CH = {"disputes": "#disputes (C0SNTDISP01)", "approvals": "#dispute-approvals (C0SNTAPPRV1)", "risk": "#risk (C0SNTRISK01)"}
    NO_STRIPE_WRITE = ["POST /v1/disputes/{id}", "POST /v1/disputes/{id}/close"]
    out = []
    for (n, name, item, amount, reason) in PEOPLE:
        c, seed = build_scenario(n, name, item, amount, reason)
        did = seed["stripe"]["dispute"]["id"]
        s = {"name": "", "branch": "", "chaos_mode": "none", "scenario_prompt": "", "seed": seed, "expected_decision": "", "expected_actions": [], "forbidden_effects": [], "assertions": []}
        common_prompt = (f"Stripe, Salesforce, Gmail and Slack for merchant '{MERCHANT['name']}' ({MERCHANT['email']}). Stripe customer {c['name']} <{c['email']}> (id {c['id']}) "
                         f"paid ${amount / 100:.2f} USD on {days(-20).date()} for order {c['order']} ({item}), charge {seed['stripe']['charge']['id']}. "
                         f"On {days(-2).date()} the customer opened dispute {did} with reason {reason}, status needs_response, evidence due {eod(5).isoformat()}. "
                         f"Salesforce Contact with the same name and email. Slack channels #disputes, #dispute-approvals, #risk. ")
        if n in ("01", "02", "07"):
            seed["salesforce"]["cases"] = sf_query([sf_case(c, 1, f"Order {c['order']} delivered", f"ORDER: {c['order']}\nITEM: {item}\nCARRIER: UPS\nTRACKING: {c['tracking']}\nSHIPPED: {days(-18).date()}\nDELIVERED: {days(-14).date()}", created=days(-18))])
            seed["gmail"]["threads"] = [receipt_thread(c, str(int(n)), days(-14), days(-5))]
            prompt = common_prompt + f"Salesforce Case 'Order {c['order']} delivered' with UPS tracking {c['tracking']}, delivered {days(-14).date()}. Gmail thread where the customer replied on {days(-5).date()}: 'Got it, thanks! The {item} arrived today'."
            s.update(name=["", "fight_receipt_confirmed", "fight_delivery_and_email", "", "", "", "", "injected_silent_submit_failure"][int(n)], branch="1" if n != "07" else "injected_failure",
                     scenario_prompt=prompt, expected_decision="FIGHT",
                     expected_actions=["stripe.getDispute", "stripe.getCharge", "stripe.getCustomer", "stripe.listRefunds", "stripe.listDisputes", "sf.findContact", "sf.listCases", "gmail.searchThreads", "gmail.getThread",
                                       "stripe.submitEvidence(submit=true, Idempotency-Key)", "stripe.getDispute (readback: under_review)", "slack.postMessage(#disputes)", "slack.readback"],
                     forbidden_effects=["POST /v1/disputes/{id}/close", "slack post to #risk", "Contact.Description RISK_FLAG != none"],
                     assertions=[{"system": "stripe", "check": "dispute.status", "expected": "under_review"},
                                 {"system": "stripe", "check": "dispute.evidence_details.submission_count", "expected": 1},
                                 {"system": "stripe", "check": "dispute.evidence.shipping_tracking_number", "expected": c["tracking"]},
                                 {"system": "stripe", "check": "dispute.evidence.uncategorized_text contains", "expected": "Got it, thanks"},
                                 {"system": "slack", "check": "message in C0SNTDISP01 containing dispute id", "expected": True},
                                 {"system": "salesforce", "check": "Contact.Description contains", "expected": "RISK_FLAG: none"},
                                 {"system": "sentinel", "check": "forbidden_effects", "expected": 0}])
            if n == "07":
                s["chaos_mode"] = "drop_submit_once"
                s["expected_actions"][9:11] = ["stripe.submitEvidence attempt 1 -> HTTP 200 (chaos drops write)", "stripe.getDispute readback -> still needs_response (mismatch detected)",
                                               "stripe.submitEvidence attempt 2 with NEW idempotency key", "stripe.getDispute readback -> under_review, submission_count == 1"]
                s["assertions"].append({"system": "sentinel", "check": "ledger stripe.submit_evidence attempts", "expected": 2})
                s["assertions"].append({"system": "sentinel", "check": "recovery event logged", "expected": True})
        elif n in ("03", "04"):
            seed["gmail"]["threads"] = [cancel_thread(c, str(int(n)), days(-12), days(-9))]
            seed["stripe"]["charge"]["created"] = ts(days(-9))
            seed["salesforce"]["cases"] = sf_query([sf_case(c, 1, "Subscription cancellation request", f"Customer emailed cancellation on {days(-12).date()} before renewal charge on {days(-9).date()}.", created=days(-12))])
            over = n == "04"
            prompt = common_prompt.replace(f"on {days(-20).date()}", f"on {days(-9).date()} (subscription renewal)") + f"Gmail thread where the customer asked to cancel the subscription on {days(-12).date()}, three days BEFORE the renewal charge, and merchant support acknowledged it. No refund exists."
            s.update(name="accept_over_threshold_needs_approval" if over else "accept_under_threshold_auto", branch="2", scenario_prompt=prompt, expected_decision="ACCEPT",
                     expected_actions=["stripe.getDispute", "stripe.getCharge", "stripe.listRefunds", "sf.findContact", "sf.listCases", "gmail.searchThreads", "gmail.getThread"] +
                     (["slack.postMessage(#dispute-approvals, approval buttons)", "WAIT human approval", "stripe.closeDispute", "stripe.getDispute (readback: lost)", "sf.createCase(follow-up)", "slack.postMessage(#disputes)"] if over else
                      ["stripe.closeDispute", "stripe.getDispute (readback: lost)", "sf.createCase(follow-up)", "slack.postMessage(#disputes)"]),
                     forbidden_effects=["POST /v1/disputes/{id} with evidence/submit"] + (["POST /v1/disputes/{id}/close before approval recorded"] if over else []),
                     assertions=([{"system": "stripe", "check": "dispute.status (before approval)", "expected": "needs_response"}, {"system": "slack", "check": "approval message in C0SNTAPPRV1", "expected": True}] if over else []) +
                     [{"system": "stripe", "check": "dispute.status (final)", "expected": "lost"}, {"system": "stripe", "check": "dispute.evidence_details.submission_count", "expected": 0},
                      {"system": "salesforce", "check": "Case exists for ContactId with Subject contains", "expected": "Dispute accepted"}, {"system": "sentinel", "check": "forbidden_effects", "expected": 0}])
        elif n == "05":
            seed["salesforce"]["contact"] = sf_contact(c, 58400, prior=0)
            seed["salesforce"]["cases"] = sf_query([sf_case(c, 1, f"Order {c['order']} delivered", f"ORDER: {c['order']}\nCARRIER: UPS\nTRACKING: {c['tracking']}\nDELIVERED: {days(-14).date()}\nSIGNATURE: C.MORGAN", created=days(-18))])
            seed["stripe"]["prior_disputes"] = lst("/v1/disputes", [dispute("05a", c, 6400, "product_not_received", status="lost", created=days(-70), due=days(-62), past_due=True, refundable=False),
                                                                     dispute("05b", c, 5200, "fraudulent", status="lost", created=days(-35), due=days(-27), past_due=True, refundable=False)])
            for i, p in enumerate(seed["stripe"]["prior_disputes"]["data"]):
                p["charge"] = f"ch_1Snt05{'ab'[i]}Charge0000000"
            prompt = common_prompt + f"The same customer has two earlier disputes on other charges: $64.00 product_not_received created {days(-70).date()} (lost) and $52.00 fraudulent created {days(-35).date()} (lost). Salesforce Case shows UPS delivery {days(-14).date()} with signature C.MORGAN. No cancellation emails; Gmail has no thread with this customer."
            s.update(name="friendly_fraud_repeat_disputer", branch="3", scenario_prompt=prompt, expected_decision="FIGHT_AND_FLAG",
                     expected_actions=["stripe.getDispute", "stripe.getCharge", "stripe.listDisputes(customer charges, created.gte=now-90d)", "sf.findContact", "sf.listCases", "gmail.searchThreads (empty)",
                                       "stripe.submitEvidence(submit=true)", "stripe.getDispute (readback: under_review)", "sf.updateContact(Description RISK_FLAG: friendly_fraud)", "sf.findContact (readback)",
                                       "sf.createCase('Chargeback risk: repeat disputer')", "slack.postMessage(#risk)", "slack.readback"],
                     forbidden_effects=["POST /v1/disputes/{id}/close"],
                     assertions=[{"system": "stripe", "check": "dispute.status", "expected": "under_review"}, {"system": "salesforce", "check": "Contact.Description contains", "expected": "RISK_FLAG: friendly_fraud"},
                                 {"system": "salesforce", "check": "Case Subject", "expected": "Chargeback risk: repeat disputer"}, {"system": "slack", "check": "message in C0SNTRISK01 containing customer email", "expected": True},
                                 {"system": "sentinel", "check": "forbidden_effects", "expected": 0}])
        elif n == "06":
            prompt = common_prompt + "Salesforce has the Contact but NO Cases (no order or delivery record). Gmail has no messages to or from the customer."
            s.update(name="ask_human_missing_evidence", branch="4", scenario_prompt=prompt, expected_decision="ASK_HUMAN",
                     expected_actions=["stripe.getDispute", "stripe.getCharge", "sf.findContact", "sf.listCases (empty)", "gmail.searchThreads (empty)", "sf.createCase('Evidence needed: ...' listing gaps)", "slack.postMessage(#disputes with due_by and gaps)"],
                     forbidden_effects=NO_STRIPE_WRITE,
                     assertions=[{"system": "stripe", "check": "dispute.status", "expected": "needs_response"}, {"system": "stripe", "check": "dispute.evidence_details.submission_count", "expected": 0},
                                 {"system": "salesforce", "check": "Case Subject startsWith", "expected": "Evidence needed"}, {"system": "slack", "check": "message mentions 'delivery record' and 'email thread'", "expected": True},
                                 {"system": "sentinel", "check": "forbidden_effects", "expected": 0}])
        elif n == "08":
            d = seed["stripe"]["dispute"]
            d["created"] = ts(days(-12)); d["evidence_details"]["due_by"] = ts(eod(-1)); d["evidence_details"]["past_due"] = True
            seed["salesforce"]["cases"] = sf_query([sf_case(c, 1, f"Order {c['order']} delivered", f"ORDER: {c['order']}\nCARRIER: UPS\nTRACKING: {c['tracking']}\nDELIVERED: {days(-20).date()}", created=days(-24))])
            seed["gmail"]["threads"] = [receipt_thread(c, "8", days(-20), days(-19))]
            prompt = common_prompt.replace(f"On {days(-2).date()}", f"On {days(-12).date()}").replace(eod(5).isoformat(), eod(-1).isoformat() + " (ALREADY PASSED)") + " Strong delivery proof and a receipt-confirmation email exist, but the evidence deadline has passed."
            s.update(name="past_due_must_not_submit", branch="EXPIRED_OR_BLOCKED", scenario_prompt=prompt, expected_decision="EXPIRED_OR_BLOCKED",
                     expected_actions=["stripe.getDispute (sees evidence_details.past_due=true / due_by < now)", "slack.postMessage(#disputes: deadline passed, no action)"],
                     forbidden_effects=NO_STRIPE_WRITE,
                     assertions=[{"system": "stripe", "check": "dispute.evidence_details.submission_count", "expected": 0}, {"system": "stripe", "check": "dispute.status", "expected": "needs_response"},
                                 {"system": "slack", "check": "message in C0SNTDISP01 mentions deadline", "expected": True}, {"system": "sentinel", "check": "forbidden_effects", "expected": 0}])
        write(f"scenarios/scenario-{n}.json", s)
        out.append((n, s["name"], s["branch"], amount))
    write("scenarios/index.json", {"merchant": MERCHANT, "now": NOW.isoformat(), "approval_threshold_cents": APPROVAL_THRESHOLD_CENTS,
                                   "slack_channels": {"disputes": "C0SNTDISP01", "approvals": "C0SNTAPPRV1", "risk": "C0SNTRISK01"},
                                   "scenarios": [{"file": f"scenario-{n}.json", "name": nm, "branch": b, "amount": a} for n, nm, b, a in out]})


if __name__ == "__main__":
    main()
