"""Stable whole-public-schema state for manual namespace rollback evidence."""
import json
import re

STATE_SQL = r"""
SELECT '__NAMESPACE_STATE__' || COALESCE(jsonb_object_agg(identity,state),'{}'::jsonb)::text FROM (
 SELECT 'routine:'||p.oid::regprocedure::text identity,
        jsonb_build_object('source',p.prosrc,'config',p.proconfig,'acl',p.proacl,'owner',p.proowner::regrole::text,
          'definer',p.prosecdef,'volatility',p.provolatile,'kind',p.prokind,'strict',p.proisstrict,
          'leakproof',p.proleakproof,'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows,
          'result',pg_get_function_result(p.oid),'args',pg_get_function_arguments(p.oid),'language',l.lanname,
          'comment',obj_description(p.oid,'pg_proc')) state
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','auth')
 UNION ALL
 SELECT 'relation:'||c.relname, jsonb_build_object('kind',c.relkind,'acl',c.relacl,'owner',c.relowner::regrole::text,
    'options',c.reloptions,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'definition',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) ELSE NULL END)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p','S')
 UNION ALL
 SELECT 'column:'||c.relname||'.'||a.attname, jsonb_build_object('number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'notnull',a.attnotnull,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'trigger:'||c.relname||'.'||t.tgname, jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'constraint:'||c.relname||'.'||k.conname, jsonb_build_object('definition',pg_get_constraintdef(k.oid),'validated',k.convalidated,
    'deferred',k.condeferred,'deferrable',k.condeferrable)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'index:'||c.relname, jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'policy:'||c.relname||'.'||p.polname, jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
    'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'schema:'||n.nspname,jsonb_build_object('owner',n.nspowner::regrole::text,'acl',n.nspacl)
 FROM pg_namespace n WHERE n.nspname IN ('public','auth')
 UNION ALL
 SELECT 'rule:'||c.relname||'.'||r.rulename,jsonb_build_object('definition',pg_get_ruledef(r.oid))
 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND r.rulename <> '_RETURN'
) AS state;
"""


def states(output):
    return [json.loads(line.strip().removeprefix("__NAMESPACE_STATE__"))
            for line in output.splitlines() if line.strip().startswith("__NAMESPACE_STATE__")]


def retained_column_normalization(state):
    result = dict(state)
    for name in ("listening_tests", "listening_content", "listening_test_attempts", "dictation_sessions", "listening_public_practice_catalog"):
        result.pop("column:" + name + ".restricted", None)
    key = "relation:listening_public_practice_catalog"
    if key in result:
        result[key] = {**result[key], "definition": re.sub(r",\s*(?:t\.)?restricted(?=\s+FROM)", "", result[key]["definition"])}
    return result
