import workers.cmd as cmd
from workers.config import config
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

def batch_download(celery_task, batch_id, **kwargs):

  batch_script = config['batch_script']

  stdout, stderr = cmd.execute(['python', f'{batch_script}', f'{batch_id}'])

  logger.info(f'STDOUT: {stdout} STDERR: {stderr}')

  # print(f'STDOUT: {stdout} STDERR: {stderr}')
  # if stderr:
  #   raise Exception(stderr)

  
  
  return batch_id,