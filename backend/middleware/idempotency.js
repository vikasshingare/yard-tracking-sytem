const crypto = require('node:crypto');

function idempotency(pool) {
  return async (req, res, next) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key) return next();
    if (key.length > 100) return res.status(400).json({ error: 'Idempotency key is too long.' });
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    try {
      await pool.execute(
        'INSERT INTO IdempotencyKeys (user_id,idempotency_key,request_path,request_hash) VALUES (?,?,?,?)',
        [req.user.id, key, req.originalUrl.split('?')[0], requestHash]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') return next(err);
      const [[saved]] = await pool.execute(
        'SELECT request_path AS requestPath,request_hash AS requestHash,response_status AS responseStatus,response_body AS responseBody,state FROM IdempotencyKeys WHERE user_id=? AND idempotency_key=?',
        [req.user.id, key]);
      if (!saved || saved.requestPath !== req.originalUrl.split('?')[0] || saved.requestHash !== requestHash) {
        return res.status(409).json({ error: 'This retry key was already used for a different operation.' });
      }
      if (saved.state !== 'complete') return res.status(409).json({ error: 'This operation is still processing. Refresh before retrying.' });
      res.set('Idempotent-Replay', 'true');
      return res.status(saved.responseStatus || 200).json(JSON.parse(saved.responseBody || '{}'));
    }

    const originalJson = res.json.bind(res);
    let savedResponse = false;
    res.json = (body) => {
      if (savedResponse) return originalJson(body);
      savedResponse = true;
      pool.execute(
        "UPDATE IdempotencyKeys SET response_status=?,response_body=?,state='complete' WHERE user_id=? AND idempotency_key=?",
        [res.statusCode, JSON.stringify(body), req.user.id, key],
      ).then(() => originalJson(body)).catch(next);
      return res;
    };
    next();
  };
}

module.exports = idempotency;
