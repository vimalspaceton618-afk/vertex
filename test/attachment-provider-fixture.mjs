import { createServer } from 'node:http';
import { once } from 'node:events';

// Deterministic provider responses exercise the real manager, reader and vision tool.
export async function attachmentProvider(t) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push(body);
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Image fixture received' } }] }));
      return;
    }

    function tool(index, name, args) {
      return { index, id: 'call_' + index, type: 'function', function: { name, arguments: JSON.stringify(args) } };
    }
    const last = body.messages.at(-1);
    const manager = body.tools.some(item => item.function.name === 'delegate_task');
    let delta;
    if (last.role === 'tool') {
      delta = { content: manager ? 'Attachment scenario complete' : 'Inspected both fixtures' };
    } else if (manager) {
      delta = { tool_calls: [tool(0, 'delegate_task', { agentName: 'ExploreAgent', prompt: last.content })] };
    } else {
      delta = { tool_calls: [
        tool(0, 'read_file', { filePath: 'notes draft.md' }),
        tool(1, 'analyze_image', { imagePath: 'diagram.png', prompt: 'Describe the image' }),
      ] };
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return { url: 'http://127.0.0.1:' + server.address().port + '/v1', requests };
}
