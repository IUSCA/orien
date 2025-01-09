const config = require('config');

const wfService = require('./workflow');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const intiate_download = async (batch_id, user_id) => {



  const wf_body = {
      steps: [
        {
          name: "batch_download",
          task: "batch_download",
          queue: `${config.app_id}.q`

        }
      ],
      name: "batch_download",
      app_id: config.app_id,
  
    }
  

  console.log('Creating workflow', wf_body, 'for batch_id:', batch_id);

  // create the workflow
  const wf = (await wfService.create({
    ...wf_body,
    args: [batch_id],
    
  })).data;

  await prisma.workflow.create({
    data: {
      id: wf.workflow_id,
      initiator_id: user_id 
    }

  });

  console.log('Workflow:', wf);

  return wf;
}

module.exports = {
  intiate_download
}