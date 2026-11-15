// Frozen synthetic saved-question fixtures; these evaluate the new-reply step, not initial extraction.
// [id, question, reply, status, promised count, reported count]
export const emailReplyCases = [
  ['amount','What is my refund amount?','Your refund amount is USD 24.','answered',0,0],
  // A payment-method answer alone is not a separate processing promise.
  ['method','Which payment method will receive my refund?','The refund will go to the original card.','answered',0,0],
  ['negative-policy','Can I refund a downloaded item?','Downloaded items are not eligible for refunds.','answered',0,0],
  ['unknown-date','What is the exact refund date?','We cannot determine the refund date.','review',0,0],
  ['unrelated','How much is the replacement fee?','You can update your delivery address in settings.','unanswered',0,0],
  ['method-not-state','Is automatic renewal disabled on my account?','You can disable automatic renewal in Billing settings.','partial',0,0],
  ['date-promise','On which date will you send the file?','We will check the dispatch date and tell you tomorrow.','waiting',1,0],
  ['action-date','On which date will you send the file?','We will send the file tomorrow.','answered',1,0],
  ['refund-processed','Has my refund been processed?','We have processed your refund.','answered',0,1],
  ['account-locked','Is my account unlocked?','Your account is still locked.','answered',0,0],
  ['receipt','Have you received my transaction ID?','We received your transaction ID.','answered',0,1],
  ['review-length','How long does the review take?','The review takes 3 business days.','answered',0,0],
  ['optional-proof','Is a screenshot required?','A screenshot is optional, not required.','answered',0,0],
  ['receipt-only','What is my case reference number?','Thank you for contacting us.','unanswered',0,0],
  ['conditional','Am I eligible for a refund?','A refund is available only if a duplicate charge is confirmed. We cannot confirm a duplicate charge yet.','partial',0,0],
  ['corrected-price','What is the repair cost?','Correction: the previously quoted USD 80 was incorrect. The repair cost is USD 60.','answered',0,0],
  ['waiting-price','What is the repair cost?','We will check the cost and email you by Friday.','waiting',1,0],
  ['unknown-reference','What is my case reference number?','We cannot locate your case reference number.','review',0,0],
  ['how-recover','How do I request account recovery?','Submit the recovery form from your account settings.','answered',0,0],
  ['cancel-reported','Has my subscription been cancelled?','We have cancelled your subscription.','answered',0,1],
];
