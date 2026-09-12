"""MCP stdio adapter. The optional SDK owns protocol framing and negotiation."""
import base64
from contextlib import redirect_stdout
import json
from pathlib import Path
import signal
import sys
import uuid

from .jsee import invoke_schema
from .transport import (inspect_schema, run_result_schema, ArtifactStore, format_run,
                        failed_run, BODY_LIMIT, ARTIFACT_LIMIT)


async def serve(schema_path, *, max_body_bytes=BODY_LIMIT, max_artifact_bytes=ARTIFACT_LIMIT):
    try:
        from mcp import types, MCPError
        from mcp.server import Server
        from mcp.server.stdio import stdio_server
    except ImportError as error:
        raise RuntimeError('MCP requires Python 3.10+ and the optional jsee[server] dependencies') from error
    if type(max_body_bytes) is not int or max_body_bytes <= 0:
        raise ValueError('max-body-bytes must be a positive integer')
    filename = Path(schema_path).resolve()
    schema = json.loads(filename.read_text(encoding='utf-8'))
    description = inspect_schema(schema)
    if not description['capabilities']['invoke']:
        raise ValueError(description['capabilities']['reason'])
    store = ArtifactStore(max_bytes=max_artifact_bytes, uri_prefix='jsee-artifact://' + str(uuid.uuid4()) + '/')

    def resource(artifact):
        return dict(uri=artifact['uri'], name=artifact['name'], mimeType=artifact['mime'], size=artifact['size'],
                    _meta={'io.jsee/sha256': artifact['sha256'], 'io.jsee/output': artifact['output']})

    async def list_tools(ctx, params):
        return types.ListToolsResult(tools=[types.Tool(
            name=description['id'], title=description['title'], description=description['description'],
            inputSchema=description['inputSchema'], outputSchema=run_result_schema(schema),
            _meta={'io.jsee/capabilities': description['capabilities']})])

    async def call_tool(ctx, params):
        if params.name != description['id']:
            raise MCPError(-32602, 'Unknown tool: ' + params.name)
        data = params.arguments or {}
        if len(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > max_body_bytes:
            invoked = failed_run('JSEE_BODY_TOO_LARGE', 'Input exceeds {} bytes'.format(max_body_bytes))
        else:
            invoked = await invoke_schema(schema, data, cwd=filename.parent)
        run = format_run(schema, invoked, store)
        content = [types.TextContent(type='text', text=json.dumps(run, allow_nan=False))]
        if run['status'] != 'succeeded':
            return types.CallToolResult(content=content, isError=True)
        content.extend(types.ResourceLink(**resource(artifact)) for artifact in run['artifacts'])
        return types.CallToolResult(content=content, structuredContent=run, isError=False)

    async def list_resources(ctx, params):
        return types.ListResourcesResult(resources=[types.Resource(**resource(a)) for a in store.entries.values()])

    async def read_resource(ctx, params):
        uri = str(params.uri)
        identifier = uri[len(store.uri_prefix):] if uri.startswith(store.uri_prefix) else ''
        artifact = store.get(identifier)
        if artifact is None:
            raise MCPError(-32602, 'Unknown artifact')
        try:
            contents = store.read(identifier)
        except OSError as error:
            raise MCPError(-32602, 'Artifact unavailable') from error
        return types.ReadResourceResult(contents=[types.BlobResourceContents(
            uri=uri, mimeType=artifact['mime'], blob=base64.b64encode(contents).decode('ascii'))])

    from importlib.metadata import version, PackageNotFoundError
    try:
        package_version = version('jsee')
    except PackageNotFoundError:
        package_version = 'development'
    server = Server('jsee', version=package_version, on_list_tools=list_tools, on_call_tool=call_tool,
                    on_list_resources=list_resources, on_read_resource=read_resource)
    def terminate(signum, frame):
        # Clients may send SIGTERM immediately after EOF (including discovery probes).
        store.close()
        raise SystemExit(0)

    previous_sigterm = signal.signal(signal.SIGTERM, terminate)
    try:
        # The SDK claims the wire descriptors. Redirect Python's buffered stdout too,
        # so model diagnostics reach stderr while the session is still running.
        async with stdio_server() as (read_stream, write_stream):
            with redirect_stdout(sys.stderr):
                await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
        store.close()
