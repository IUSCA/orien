from celery import Celery
from sca_rhythm import WorkflowTask

import workers.config.celeryconfig as celeryconfig
from workers import exceptions as exc

app = Celery("tasks")
app.config_from_object(celeryconfig)


TWO_DAYS = 2 * 24 * 60 * 60

@app.task(base=WorkflowTask, bind=True, name='archive_dataset',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def archive_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.archive import archive_dataset as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='delete_dataset',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def delete_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.delete import delete_dataset as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='download_illumina_dataset',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def download_illumina_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.illumina_download import download_illumina_dataset as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='inspect_dataset',
          autoretry_for=(exc.RetryableException,),
          max_retries=3,
          default_retry_delay=5)
def inspect_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.inspect import inspect_dataset as task_body
    try:
        return task_body(celery_task, dataset_id, **kwargs)
    except exc.InspectionFailed:
        raise
    except Exception as e:
        raise exc.RetryableException(e)


@app.task(base=WorkflowTask, bind=True, name='generate_qc',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def generate_qc(celery_task, dataset_id, **kwargs):
    from workers.tasks.qc import generate_qc as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='stage_dataset',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def stage_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.stage import stage_dataset as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='validate_dataset',
          autoretry_for=(exc.RetryableException,),
          max_retries=3,
          default_retry_delay=5)
def validate_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.validate import validate_dataset as task_body
    try:
        return task_body(celery_task, dataset_id, **kwargs)
    except exc.ValidationFailed:
        raise
    except Exception as e:
        raise exc.RetryableException(e)


@app.task(base=WorkflowTask, bind=True, name='setup_dataset_download',
          autoretry_for=(exc.RetryableException,),
          max_retries=3,
          default_retry_delay=5)
def setup_dataset_download(celery_task, dataset_id, **kwargs):
    from workers.tasks.download import setup_download as task_body
    try:
        return task_body(celery_task, dataset_id, **kwargs)
    except exc.ValidationFailed:
        raise
    except Exception as e:
        raise exc.RetryableException(e)


@app.task(base=WorkflowTask, bind=True, name='await_stability',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def await_stability(celery_task, dataset_id, **kwargs):
    from workers.tasks.await_stability import await_stability as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='delete_source',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def delete_source(celery_task, dataset_id, **kwargs):
    from workers.tasks.delete_source import delete_source as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='mark_archived_and_delete',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def delete_dataset(celery_task, dataset_id, **kwargs):
    from workers.tasks.mark_archived_and_delete import mark_archived_and_delete as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='metadata',
          autoretry_for=(Exception,),
          max_retries=3,
          default_retry_delay=5)
def metadata(celery_task, dataset_id, **kwargs):
    from workers.tasks.bc2_metadata import get_metadata_from_csv as task_body
    return task_body(celery_task, dataset_id, **kwargs)

# https://stackoverflow.com/questions/11672179/setting-time-limit-on-specific-task-with-celery
# set time limit for this task to 2 days
@app.task(base=WorkflowTask, bind=True, name='batch_download', time_limit=TWO_DAYS,)
def batch_download(celery_task, batch_id, **kwargs):
    from workers.tasks.bc2_batch_download import batch_download as task_body
    return task_body(celery_task, batch_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='process_dataset_upload',
          autoretry_for=(exc.RetryableException,),
          max_retries=3,
          default_retry_delay=5)
def process_dataset_upload(celery_task, dataset_id, **kwargs):
    from workers.tasks.process_dataset_upload import process as task_body
    return task_body(celery_task, dataset_id, **kwargs)


@app.task(base=WorkflowTask, bind=True, name='cancel_dataset_upload',
          autoretry_for=(exc.RetryableException,),
          max_retries=3,
          default_retry_delay=5)
def cancel_dataset_upload(celery_task, dataset_id, **kwargs):
    from workers.tasks.cancel_dataset_upload import purge_uploaded_resources as task_body
    return task_body(celery_task, dataset_id, **kwargs)
