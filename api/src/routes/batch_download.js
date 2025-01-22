const express = require('express');
const router = express.Router();
const { accessControl } = require('../middleware/auth');

const isPermittedTo = accessControl('batch_download');
const batchDownloadService = require('../services/batch_download');

const wf_service = require('../services/workflow');
const config = require('config');

router.get('/:id', isPermittedTo('create'), async (req, res) => {
  try {
    const { id } = req.params;

    const counts = (await wf_service.getCountsByStatus({ app_id: config.app_id })).data;
    console.log('counts', counts);

    if((counts['PENDING'] + counts['STARTED']) > 0) {
      return res.status(400).json({ error: 'There are pending or started workflows. Please wait until they are completed.' });
    }


    const workflow = await batchDownloadService.intiate_download(id, req.user.id);
    res.json(workflow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
