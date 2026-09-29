BEGIN;
-- Reconstruct only facts that still have durable records and timestamps.
-- SNAPSHOT means current saved values, never an invented before/after change.
WITH legacy AS (
 SELECT r.payload,r.created_at,r.updated_at,min(a.occurred_at) AS tracking_start
 FROM d4u_content_record r JOIN d4u_invoice_audit a ON a.invoice_number=r.payload->>'display_id' AND a.operation='BASELINE'
 WHERE r.key LIKE 'invoice:%' AND r.deleted_at IS NULL GROUP BY r.id
), events AS (
 SELECT l.payload->>'display_id' AS number,'invoice:'||(l.payload->>'display_id')||':created' AS event_key,
  l.created_at AS happened_at,'d4u_content_record' AS source,'CREATED' AS operation,l.payload->>'created_by' AS actor,
  jsonb_build_object('order_id',l.payload->>'order_id','display_id',l.payload->>'display_id') AS data,l.tracking_start
 FROM legacy l
 UNION ALL
 SELECT l.payload->>'display_id','session:'||s.id||':created',s.created_at,'payment_session','CREATED',NULL,
  jsonb_build_object('id',s.id,'provider_id',s.provider_id,'amount',s.amount,'currency_code',s.currency_code),l.tracking_start
 FROM legacy l JOIN payment_session s ON s.payment_collection_id=l.payload->>'payment_collection_id'
 UNION ALL
 SELECT l.payload->>'display_id','session:'||s.id||':authorized',s.authorized_at,'payment_session','AUTHORIZED',NULL,
  jsonb_build_object('id',s.id,'provider_id',s.provider_id,'amount',s.amount,'currency_code',s.currency_code),l.tracking_start
 FROM legacy l JOIN payment_session s ON s.payment_collection_id=l.payload->>'payment_collection_id' WHERE s.authorized_at IS NOT NULL
 UNION ALL
 SELECT l.payload->>'display_id','session:'||s.id||':closed',s.deleted_at,'payment_session','CLOSED',NULL,
  jsonb_build_object('id',s.id,'provider_id',s.provider_id,'result','Local payment session removed; this does not establish bank cancellation.'),l.tracking_start
 FROM legacy l JOIN payment_session s ON s.payment_collection_id=l.payload->>'payment_collection_id' WHERE s.deleted_at IS NOT NULL
 UNION ALL
 SELECT l.payload->>'display_id','payment:'||p.id||':created',p.created_at,'payment','CREATED',NULL,
  jsonb_build_object('id',p.id,'payment_session_id',p.payment_session_id,'provider_id',p.provider_id,'amount',p.amount,'currency_code',p.currency_code),l.tracking_start
 FROM legacy l JOIN payment p ON p.payment_collection_id=l.payload->>'payment_collection_id'
 UNION ALL
 SELECT l.payload->>'display_id','capture:'||c.id,c.created_at,'capture','CAPTURED',c.created_by,
  jsonb_build_object('id',c.id,'payment_id',p.id,'provider_id',p.provider_id,'amount',c.amount,'currency_code',p.currency_code,
   'capture_id',p.data->>'capture_id','ocean_payment_id',p.data->>'ocean_payment_id'),l.tracking_start
 FROM legacy l JOIN payment p ON p.payment_collection_id=l.payload->>'payment_collection_id' JOIN capture c ON c.payment_id=p.id WHERE c.deleted_at IS NULL
 UNION ALL
 SELECT l.payload->>'display_id','payment:'||p.id||':captured',p.captured_at,'payment','CAPTURED',NULL,
  jsonb_build_object('id',p.id,'provider_id',p.provider_id,'amount',p.amount,'currency_code',p.currency_code),l.tracking_start
 FROM legacy l JOIN payment p ON p.payment_collection_id=l.payload->>'payment_collection_id'
 WHERE p.captured_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM capture c WHERE c.payment_id=p.id AND c.deleted_at IS NULL)
 UNION ALL
 SELECT l.payload->>'display_id','refund:'||f.id,f.created_at,'refund','REFUNDED',f.created_by,
  d4u_invoice_snapshot('refund',to_jsonb(f))||jsonb_build_object('provider_id',p.provider_id,'currency_code',p.currency_code),l.tracking_start
 FROM legacy l JOIN payment p ON p.payment_collection_id=l.payload->>'payment_collection_id' JOIN refund f ON f.payment_id=p.id WHERE f.deleted_at IS NULL
 UNION ALL
 SELECT l.payload->>'display_id','order:'||o.id||':canceled',o.canceled_at,'order','CANCELED',NULL,
  jsonb_build_object('id',o.id,'status','canceled'),l.tracking_start
 FROM legacy l JOIN "order" o ON o.id=l.payload->>'order_id' WHERE o.canceled_at IS NOT NULL
 UNION ALL
 SELECT l.payload->>'display_id','address:'||a.id||':snapshot',a.updated_at,'order_address','SNAPSHOT',NULL,
  d4u_invoice_snapshot('order_address',to_jsonb(a))||jsonb_build_object('address_type',CASE WHEN a.id=o.shipping_address_id THEN 'Shipping' ELSE 'Billing' END),l.tracking_start
 FROM legacy l JOIN "order" o ON o.id=l.payload->>'order_id' JOIN order_address a ON a.id=o.shipping_address_id OR a.id=o.billing_address_id
 UNION ALL
 SELECT l.payload->>'display_id','receipt:'||r.id||':snapshot',r.updated_at,'ocean_receipt','SNAPSHOT',NULL,
  d4u_invoice_snapshot('ocean_receipt',to_jsonb(r)),l.tracking_start
 FROM legacy l JOIN payment_session s ON s.payment_collection_id=l.payload->>'payment_collection_id'
 JOIN d4u_content_record r ON r.key='ocean-receipt:'||s.id AND r.deleted_at IS NULL
 UNION ALL
 SELECT l.payload->>'display_id','notification:'||r.id||':queued',r.created_at,
  CASE WHEN r.key LIKE 'invoice-mail:%' THEN 'invoice_email' ELSE 'payment_notification' END,'QUEUED',NULL,
  jsonb_strip_nulls(jsonb_build_object('channel',r.payload->>'channel','recipient',COALESCE(r.payload->>'recipient',CASE WHEN r.payload->>'channel'='email' THEN r.payload->>'email' END),'queue',CASE WHEN r.payload->>'channel'='queue' THEN r.payload->>'queue' END,'state','pending')),l.tracking_start
 FROM legacy l JOIN d4u_content_record r ON r.payload->>'order_id'=l.payload->>'order_id' AND (r.key LIKE 'paid-notification:%' OR r.key LIKE 'invoice-mail:%') AND r.deleted_at IS NULL
 UNION ALL
 SELECT l.payload->>'display_id','notification:'||r.id||':sent',(r.payload->>'sent_at')::timestamptz,
  CASE WHEN r.key LIKE 'invoice-mail:%' THEN 'invoice_email' ELSE 'payment_notification' END,'SENT',NULL,
  d4u_invoice_snapshot(CASE WHEN r.key LIKE 'invoice-mail:%' THEN 'invoice_email' ELSE 'payment_notification' END,to_jsonb(r)),l.tracking_start
 FROM legacy l JOIN d4u_content_record r ON r.payload->>'order_id'=l.payload->>'order_id' AND (r.key LIKE 'paid-notification:%' OR r.key LIKE 'invoice-mail:%') AND r.deleted_at IS NULL
 WHERE r.payload->>'state'='sent' AND r.payload->>'sent_at' IS NOT NULL
)
INSERT INTO d4u_invoice_audit(invoice_number,occurred_at,source,operation,actor,after_value,provenance,event_key)
SELECT number,happened_at,source,operation,actor,data,'recovered','recovered:'||event_key FROM events
WHERE happened_at<tracking_start
ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;
COMMIT;
