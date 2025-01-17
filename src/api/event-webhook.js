const router = require('express').Router();
const { emmit } = require('../libs/event.js')


router.post('/', async(req, res) => {
	const { body } = req;
	emmit(body.type, body.data);
	res.end();
});

module.exports = router;