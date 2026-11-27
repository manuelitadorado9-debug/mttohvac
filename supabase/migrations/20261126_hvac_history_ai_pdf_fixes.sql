-- HVAC GMAO · Migración acumulada 2026-11-26
-- 1) La vista ligera conserva el indicador de evidencia y los metadatos de cierre,
--    sin exponer arreglos de fotos ni imágenes de firmas.
-- 2) La RPC guarda recomendaciones IA en el payload sin reemplazar la orden completa.
-- No modifica ejecuciones, equipos, firmas gráficas ni fotografías existentes.

BEGIN;

CREATE OR REPLACE FUNCTION public.hvac_strip_order_photos(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
    k text;
    v jsonb;
    cleaned jsonb := '{}'::jsonb;
    execs jsonb;
    existing_count integer;
    actual_count integer;
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
        RETURN '{}'::jsonb;
    END IF;

    execs := p->'executions';
    IF execs IS NOT NULL AND jsonb_typeof(execs) = 'object' THEN
        FOR k, v IN SELECT key, value FROM jsonb_each(execs) LOOP
            IF jsonb_typeof(v) = 'object' THEN
                existing_count := CASE
                    WHEN COALESCE(v->>'photosCount', '') ~ '^[0-9]+$'
                    THEN (v->>'photosCount')::integer ELSE 0 END;
                actual_count :=
                    CASE WHEN jsonb_typeof(v->'photos') = 'array' THEN jsonb_array_length(v->'photos') ELSE 0 END
                    + CASE WHEN jsonb_typeof(v->'fotosAntes') = 'array' THEN jsonb_array_length(v->'fotosAntes') ELSE 0 END
                    + CASE WHEN jsonb_typeof(v->'fotosDespues') = 'array' THEN jsonb_array_length(v->'fotosDespues') ELSE 0 END
                    + CASE WHEN jsonb_typeof(v->'fotosAdicionales') = 'array' THEN jsonb_array_length(v->'fotosAdicionales') ELSE 0 END;
                cleaned := jsonb_set(
                    cleaned,
                    ARRAY[k],
                    (v - 'photos' - 'fotosAntes' - 'fotosDespues' - 'fotosAdicionales') ||
                    jsonb_build_object(
                        '_lite', true,
                        'photosCount', GREATEST(existing_count, actual_count),
                        '_liteHasEvidence', GREATEST(existing_count, actual_count) > 0
                    ),
                    true
                );
            ELSE
                cleaned := jsonb_set(cleaned, ARRAY[k], v, true);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'id', COALESCE(p->>'id', ''),
        'client', COALESCE(p->>'client', ''),
        'date', COALESCE(p->>'date', ''),
        'status', COALESCE(p->>'status', 'PENDING'),
        'technician', COALESCE(p->>'technician', ''),
        'technicians', CASE WHEN jsonb_typeof(p->'technicians') = 'array' THEN p->'technicians' ELSE '[]'::jsonb END,
        'equipmentIds', CASE WHEN jsonb_typeof(p->'equipmentIds') = 'array' THEN p->'equipmentIds' ELSE '[]'::jsonb END,
        'maintenanceType', COALESCE(p->>'maintenanceType', 'PREVENTIVO'),
        'type', COALESCE(p->>'type', 'PREVENTIVO'),
        'tipoRutina', COALESCE(p->>'tipoRutina', 'PREVENTIVO'),
        'zoneName', COALESCE(p->>'zoneName', ''),
        'zoneId', COALESCE(p->>'zoneId', ''),
        'periodicity', COALESCE(p->>'periodicity', ''),
        'technicianFinished', COALESCE(p->>'technicianFinished', 'false'),
        'technicianFinishedAt', COALESCE(p->>'technicianFinishedAt', ''),
        'updatedAt', COALESCE(p->>'updatedAt', ''),
        'signatureDecision', COALESCE(p->'signatureDecision', 'null'::jsonb),
        'signatureDecisionAt', COALESCE(p->'signatureDecisionAt', 'null'::jsonb),
        'signatureDecisionBy', COALESCE(p->'signatureDecisionBy', 'null'::jsonb),
        'signatureDecisionReason', COALESCE(p->'signatureDecisionReason', 'null'::jsonb),
        'clientSignature', CASE
            WHEN jsonb_typeof(p->'clientSignature') = 'object' THEN
                jsonb_strip_nulls(jsonb_build_object(
                    'name', NULLIF(p->'clientSignature'->>'name', ''),
                    'timestamp', NULLIF(p->'clientSignature'->>'timestamp', ''),
                    '_lite', true
                ))
            ELSE 'null'::jsonb
        END,
        'executions', cleaned
    );
END;
$function$;

-- Escritura acotada: actualiza recomendaciones IA y updatedAt dentro del JSONB, sin reemplazar el payload.
-- SECURITY INVOKER mantiene vigentes las políticas RLS de hvac_orders.
CREATE OR REPLACE FUNCTION public.hvac_store_ai_recommendations(
    p_order_id text,
    p_recommendations jsonb,
    p_fingerprint text,
    p_generated_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
    affected integer := 0;
BEGIN
    IF p_order_id IS NULL OR btrim(p_order_id) = ''
       OR p_fingerprint IS NULL OR btrim(p_fingerprint) = ''
       OR p_generated_at IS NULL
       OR p_recommendations IS NULL
       OR jsonb_typeof(p_recommendations) <> 'array'
       OR jsonb_array_length(p_recommendations) > 6 THEN
        RAISE EXCEPTION 'Datos de recomendaciones IA inválidos';
    END IF;

    UPDATE public.hvac_orders AS o
       SET payload = jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 COALESCE(o.payload, '{}'::jsonb),
                 '{aiRecommendations}', p_recommendations, true
               ),
               '{aiRecommendationsFingerprint}', to_jsonb(p_fingerprint), true
             ),
             '{aiRecommendationsGeneratedAt}', to_jsonb(p_generated_at), true
           ),
           '{updatedAt}', to_jsonb(p_generated_at), true
       ) || jsonb_build_object('aiRecommendationsSavedAt', p_generated_at)
     WHERE o.id::text = p_order_id
        OR o.payload->>'id' = p_order_id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.hvac_store_ai_recommendations(text, jsonb, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hvac_store_ai_recommendations(text, jsonb, text, timestamptz) TO anon, authenticated;

COMMIT;
