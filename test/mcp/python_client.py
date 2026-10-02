"""Independent SDK client: exercise either runtime through real stdio processes."""
import asyncio
import base64
import hashlib
import json
from pathlib import Path
import sys

from mcp import Client, MCPError
from mcp.client.stdio import StdioServerParameters


async def main():
    config = json.loads(sys.argv[1])
    cases = json.loads(Path(config.pop('fixtures')).read_text())
    mode = config.pop('mode')
    async with Client(StdioServerParameters(**config), mode=mode, read_timeout_seconds=10) as client:
        tools = (await client.list_tools()).tools
        assert len(tools) == 2 and tools[0].name == 'clean_sales'
        assert tools[0].input_schema['properties']['missing']['enum'] == ['drop', 'error']
        assert tools[0].output_schema['properties']['outputs']['required'] == ['summary', 'table', 'cleaned_csv']
        assert (await client.list_resources()).resources == []
        for case in cases:
            result = await client.call_tool('clean_sales', case['data'])
            run = json.loads(result.content[0].text)
            if 'error' in case:
                assert result.is_error and run['error']['code'] == case['error'], (case['name'], run)
            else:
                assert not result.is_error
                assert result.structured_content == run
                assert run['outputs']['summary'] == case['summary']
                assert 'result' not in run
                artifact = run['artifacts'][0]
                assert result.content[1].uri == artifact['uri']
                read = await client.read_resource(artifact['uri'])
                data = base64.b64decode(read.contents[0].blob, validate=True)
                assert data == case['csv'].encode()
                assert artifact['size'] == len(data) and artifact['sha256'] == hashlib.sha256(data).hexdigest()
        assert len((await client.list_resources(cache_mode='reload')).resources) == sum('error' not in c for c in cases)
        for operation in (client.call_tool('unknown', {}), client.read_resource('file:///etc/passwd')):
            try:
                await operation
            except MCPError:
                pass
            else:
                raise AssertionError('Unknown tool/resource should fail')
    print(json.dumps({'client': 'python', 'mode': mode, 'cases': len(cases)}))


asyncio.run(main())
