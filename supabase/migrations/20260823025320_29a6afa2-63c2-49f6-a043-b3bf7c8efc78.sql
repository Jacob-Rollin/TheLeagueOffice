CREATE OR REPLACE FUNCTION public.verify_and_consume_invite_code(target_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  IF target_code IS NULL OR btrim(target_code) = '' THEN
    RETURN false;
  END IF;

  DELETE FROM public.invite_codes
  WHERE upper(btrim(code)) = upper(btrim(target_code));

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_and_consume_invite_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_invite_code(text) TO anon, authenticated, service_role;