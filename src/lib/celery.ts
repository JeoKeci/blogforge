import { redis } from './redis';
import { randomUUID } from 'crypto';

/**
 * Dispatches a Celery task via Redis broker.
 * Mimics Python's `app.send_task()` by pushing a Celery-compatible
 * message onto the 'celery' queue list.
 */
export async function sendCeleryTask(
  taskName: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<string> {
  const taskId = randomUUID();

  // Celery message body format (v2 protocol)
  const body = JSON.stringify([
    args,
    kwargs,
    { callbacks: null, errbacks: null, chain: null, chord: null },
  ]);

  const headers = {
    lang: 'py',
    task: taskName,
    id: taskId,
    shadow: null,
    eta: null,
    expires: null,
    group: null,
    group_index: null,
    retries: 0,
    timelimit: [null, null],
    root_id: taskId,
    parent_id: null,
    argsrepr: JSON.stringify(args),
    kwargsrepr: JSON.stringify(kwargs),
    origin: 'next.js@blogforge',
    ignore_result: false,
  };

  const properties = {
    correlation_id: taskId,
    reply_to: '',
    delivery_mode: 2,
    delivery_tag: taskId,
    delivery_info: {
      exchange: '',
      routing_key: 'celery',
    },
    priority: 0,
    body_encoding: 'base64',
  };

  const message = JSON.stringify({
    body: Buffer.from(body).toString('base64'),
    'content-encoding': 'utf-8',
    'content-type': 'application/json',
    headers,
    properties,
  });

  // Push the message to Celery's default queue
  await redis.lpush('celery', message);

  return taskId;
}
