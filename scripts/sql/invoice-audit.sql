BEGIN;
CREATE TABLE IF NOT EXISTS d4u_invoice_audit (
 id bigserial PRIMARY KEY,
 invoice_number text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL,
 operation text NOT NULL,
 actor text,
 before_value jsonb,
 after_value jsonb
);
CREATE INDEX IF NOT EXISTS d4u_invoice_audit_lookup ON d4u_invoice_audit(invoice_number,id DESC);
ALTER TABLE d4u_invoice_audit ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'recorded';
ALTER TABLE d4u_invoice_audit ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE d4u_invoice_audit ADD COLUMN IF NOT EXISTS actor_name_snapshot text;
CREATE UNIQUE INDEX IF NOT EXISTS d4u_invoice_audit_event_key ON d4u_invoice_audit(event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS d4u_invoice_audit_time ON d4u_invoice_audit(invoice_number,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS d4u_invoice_order_lookup ON d4u_content_record ((payload->>'order_id')) WHERE key LIKE 'invoice:%' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS d4u_invoice_collection_lookup ON d4u_content_record ((payload->>'payment_collection_id')) WHERE key LIKE 'invoice:%' AND deleted_at IS NULL;

-- Resolve verified Feishu identities, including native Medusa user bindings.
-- The client cannot choose this name; it comes from server-side login records.
CREATE OR REPLACE FUNCTION d4u_invoice_actor_name(actor_id text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN actor_id='payment_link' THEN 'User' ELSE COALESCE(
  (SELECT NULLIF(s.payload->'user'->>'name','') FROM d4u_content_record s
   WHERE s.key='feishu-seen:'||actor_id AND s.deleted_at IS NULL),
  (SELECT NULLIF(s.payload->'user'->>'name','') FROM d4u_content_record b
   JOIN d4u_content_record s ON s.key=replace(b.key,'feishu-binding:','feishu-seen:') AND s.deleted_at IS NULL
   WHERE b.key LIKE 'feishu-binding:%' AND b.payload->>'user_id'=actor_id AND b.deleted_at IS NULL
   ORDER BY s.updated_at DESC LIMIT 1),
  (SELECT NULLIF(trim(concat_ws(' ',u.first_name,u.last_name)),'') FROM "user" u WHERE u.id=actor_id)
 ) END;
$$;
CREATE OR REPLACE FUNCTION d4u_set_invoice_actor_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.actor_name_snapshot := COALESCE(NEW.actor_name_snapshot,d4u_invoice_actor_name(NEW.actor));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS d4u_invoice_actor_name ON d4u_invoice_audit;
CREATE TRIGGER d4u_invoice_actor_name BEFORE INSERT ON d4u_invoice_audit FOR EACH ROW EXECUTE FUNCTION d4u_set_invoice_actor_name();

-- Explicit field allowlists: payment secrets, signatures, tokens and full card
-- data must never enter the audit table (including values later removed).
CREATE OR REPLACE FUNCTION d4u_invoice_snapshot(kind text, row_value jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb; fields text[]; result jsonb;
BEGIN
 IF row_value IS NULL THEN RETURN NULL; END IF;
 v := row_value;
 CASE kind
 WHEN 'd4u_content_record' THEN
  v := row_value->'payload';
  fields := ARRAY['order_id','display_id','amount','currency_code','note','email','customer_note','created_by','payment_provider','payment_version','items','contact_version'];
 WHEN 'invoice_email' THEN
  v := row_value->'payload'; fields := ARRAY['invoice_number','channel','recipient','state','attempts','sent_at','last_error'];
 WHEN 'payment_notification' THEN
  v := row_value->'payload'; fields := ARRAY['order_id','order_no','channel','email','queue','state','attempts','sent_at','last_error'];
 WHEN 'ocean_receipt' THEN
  v := row_value->'payload'; fields := ARRAY['order_number','order_amount','order_currency','payment_id','payment_status','payment_authType'];
 WHEN 'order' THEN
  fields := ARRAY['id','status','email','currency_code','shipping_address_id','billing_address_id','canceled_at','deleted_at'];
  v := v || jsonb_build_object('no_ocean_limit',COALESCE(row_value->'metadata'->'no_ocean_limit','false'::jsonb));
  fields := fields || ARRAY['no_ocean_limit'];
 WHEN 'order_address' THEN fields := ARRAY['id','company','first_name','last_name','address_1','address_2','city','country_code','province','postal_code','phone','deleted_at'];
 WHEN 'order_line_item' THEN fields := ARRAY['id','title','subtitle','unit_price','thumbnail','deleted_at'];
 WHEN 'order_item' THEN fields := ARRAY['id','item_id','quantity','unit_price','version','deleted_at'];
 WHEN 'order_change' THEN fields := ARRAY['id','order_id','version','change_type','status','description','internal_note','created_by','requested_by','confirmed_by','declined_by','canceled_by','requested_at','confirmed_at','declined_at','canceled_at','declined_reason','deleted_at'];
 WHEN 'payment_session' THEN fields := ARRAY['id','provider_id','amount','currency_code','status','authorized_at','deleted_at'];
 WHEN 'payment' THEN fields := ARRAY['id','provider_id','amount','currency_code','payment_session_id','captured_at','canceled_at','deleted_at'];
 WHEN 'capture' THEN fields := ARRAY['id','payment_id','amount','created_by','deleted_at'];
 WHEN 'refund' THEN fields := ARRAY['id','payment_id','amount','created_by','note','refund_reason_id','deleted_at'];
 WHEN 'payment_collection' THEN fields := ARRAY['id','amount','currency_code','authorized_amount','captured_amount','refunded_amount','completed_at','status','deleted_at'];
 ELSE RETURN '{}'::jsonb;
 END CASE;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO result FROM jsonb_each(v) WHERE key=ANY(fields);
 IF kind IN ('payment','payment_session') THEN
  result := result || jsonb_strip_nulls(jsonb_build_object(
   'paypal_order_id',CASE WHEN row_value->>'provider_id'='pp_paypal_paypal' THEN row_value->'data'->'binding'->'order_id' END,
   'capture_id',row_value->'data'->'capture_id',
   'ocean_payment_id',row_value->'data'->'ocean_payment_id',
   'last_refund_id',row_value->'data'->'last_refund_id',
   'invoice_payment_version',row_value->'data'->'invoice_payment_version'));
 END IF;
 IF kind='ocean_receipt' THEN
  result := result || jsonb_strip_nulls(jsonb_build_object(
   'payment_details',regexp_replace(left(row_value->'payload'->>'payment_details',500),'([0-9][ -]?){13,19}','[redacted]','g'),
   'payment_risk',regexp_replace(left(row_value->'payload'->>'payment_risk',500),'([0-9][ -]?){13,19}','[redacted]','g')));
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION d4u_record_invoice_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v jsonb; old_v jsonb; new_v jsonb; before_v jsonb; after_v jsonb; order_ref text; collection_ref text; inv jsonb; who text; kind text;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_v := to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN new_v := to_jsonb(NEW); END IF;
 v := COALESCE(new_v,old_v);
 kind := TG_TABLE_NAME;
 IF TG_TABLE_NAME='d4u_content_record' THEN
  IF v->>'key' LIKE 'invoice:%' THEN inv := v->'payload';
  ELSIF v->>'key' LIKE 'ocean-receipt:%' THEN
   kind := 'ocean_receipt';
   SELECT payment_collection_id INTO collection_ref FROM payment_session WHERE id=substring(v->>'key' FROM 15);
   SELECT payload INTO inv FROM d4u_content_record WHERE key LIKE 'invoice:%' AND payload->>'payment_collection_id'=collection_ref AND deleted_at IS NULL LIMIT 1;
  ELSIF v->>'key' LIKE 'invoice-mail:%' THEN
   kind := 'invoice_email';
   SELECT payload INTO inv FROM d4u_content_record WHERE key='invoice:'||(v->'payload'->>'invoice_number') AND deleted_at IS NULL LIMIT 1;
  ELSIF v->>'key' LIKE 'paid-notification:%' THEN
   kind := 'payment_notification';
   SELECT payload INTO inv FROM d4u_content_record WHERE key LIKE 'invoice:%' AND payload->>'order_id'=v->'payload'->>'order_id' AND deleted_at IS NULL LIMIT 1;
  ELSE RETURN NULL; END IF;
 ELSE
  CASE TG_TABLE_NAME
  WHEN 'order' THEN order_ref := v->>'id';
  WHEN 'order_address' THEN SELECT id INTO order_ref FROM "order" WHERE shipping_address_id=v->>'id' OR billing_address_id=v->>'id' LIMIT 1;
  WHEN 'order_item' THEN order_ref := v->>'order_id';
  WHEN 'order_change' THEN order_ref := v->>'order_id';
  WHEN 'order_line_item' THEN SELECT order_id INTO order_ref FROM order_item WHERE item_id=v->>'id' ORDER BY version DESC LIMIT 1;
  WHEN 'payment_session','payment' THEN collection_ref := v->>'payment_collection_id';
  WHEN 'capture','refund' THEN SELECT payment_collection_id INTO collection_ref FROM payment WHERE id=v->>'payment_id';
  WHEN 'payment_collection' THEN collection_ref := v->>'id';
  ELSE RETURN NULL;
  END CASE;
  IF order_ref IS NOT NULL THEN
   SELECT payload INTO inv FROM d4u_content_record WHERE key LIKE 'invoice:%' AND payload->>'order_id'=order_ref AND deleted_at IS NULL LIMIT 1;
  ELSIF collection_ref IS NOT NULL THEN
   SELECT payload INTO inv FROM d4u_content_record WHERE key LIKE 'invoice:%' AND payload->>'payment_collection_id'=collection_ref AND deleted_at IS NULL LIMIT 1;
  END IF;
 END IF;
 IF inv IS NULL THEN RETURN NULL; END IF;
 before_v := d4u_invoice_snapshot(kind,old_v);
 after_v := d4u_invoice_snapshot(kind,new_v);
 IF before_v IS NOT DISTINCT FROM after_v THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='order' THEN
  IF old_v->'metadata'->'no_ocean_limit' IS DISTINCT FROM new_v->'metadata'->'no_ocean_limit' THEN who := new_v->'metadata'->>'ocean_limit_changed_by'; END IF;
  -- Newly inserted addresses are not attached to an order until this update.
  IF old_v->>'shipping_address_id' IS DISTINCT FROM new_v->>'shipping_address_id' THEN
   before_v := before_v || jsonb_build_object('shipping_address',(SELECT d4u_invoice_snapshot('order_address',to_jsonb(a)) FROM order_address a WHERE a.id=old_v->>'shipping_address_id'));
   after_v := after_v || jsonb_build_object('shipping_address',(SELECT d4u_invoice_snapshot('order_address',to_jsonb(a)) FROM order_address a WHERE a.id=new_v->>'shipping_address_id'));
  END IF;
  IF old_v->>'billing_address_id' IS DISTINCT FROM new_v->>'billing_address_id' THEN
   before_v := before_v || jsonb_build_object('billing_address',(SELECT d4u_invoice_snapshot('order_address',to_jsonb(a)) FROM order_address a WHERE a.id=old_v->>'billing_address_id'));
   after_v := after_v || jsonb_build_object('billing_address',(SELECT d4u_invoice_snapshot('order_address',to_jsonb(a)) FROM order_address a WHERE a.id=new_v->>'billing_address_id'));
  END IF;
 ELSIF kind='d4u_content_record' AND TG_OP='INSERT' THEN who := inv->>'created_by';
 ELSIF kind='d4u_content_record' AND old_v->'payload'->'contact_version' IS DISTINCT FROM new_v->'payload'->'contact_version' THEN who := new_v->'payload'->>'contact_updated_by';
 ELSIF kind='d4u_content_record' AND old_v->'payload'->'payment_version' IS DISTINCT FROM new_v->'payload'->'payment_version' THEN who := 'payment_link';
 ELSIF TG_TABLE_NAME IN ('capture','refund') THEN who := v->>'created_by';
 ELSIF TG_TABLE_NAME='order_change' THEN
  IF new_v->'canceled_at' IS DISTINCT FROM old_v->'canceled_at' THEN who := new_v->>'canceled_by';
  ELSIF new_v->'declined_at' IS DISTINCT FROM old_v->'declined_at' THEN who := new_v->>'declined_by';
  ELSIF new_v->'confirmed_at' IS DISTINCT FROM old_v->'confirmed_at' THEN who := new_v->>'confirmed_by';
  ELSIF new_v->'requested_at' IS DISTINCT FROM old_v->'requested_at' THEN who := new_v->>'requested_by';
  ELSE who := v->>'created_by'; END IF;
 END IF;
 INSERT INTO d4u_invoice_audit(invoice_number,source,operation,actor,before_value,after_value)
 VALUES(inv->>'display_id',kind,TG_OP,who,before_v,after_v);
 RETURN NULL;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['d4u_content_record','order','order_address','order_line_item','order_item','order_change','payment_session','payment','capture','refund','payment_collection'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS d4u_invoice_change ON %I',t);
  EXECUTE format('CREATE TRIGGER d4u_invoice_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION d4u_record_invoice_change()',t);
 END LOOP;
END $$;

-- Baselines are explicitly labelled; they do not pretend to be old changes.
INSERT INTO d4u_invoice_audit(invoice_number,source,operation,after_value)
SELECT r.payload->>'display_id','history','BASELINE',jsonb_build_object('message','Detailed change tracking starts here. Earlier changes were not recorded.')
FROM d4u_content_record r WHERE r.key LIKE 'invoice:%' AND r.deleted_at IS NULL
AND NOT EXISTS(SELECT 1 FROM d4u_invoice_audit a WHERE a.invoice_number=r.payload->>'display_id');
COMMIT;
