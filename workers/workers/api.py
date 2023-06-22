from datetime import datetime
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter, Retry

import workers.utils as utils
from workers.config import config


def make_retry_adapter():
    # https://stackoverflow.com/questions/15431044/can-i-set-max-retries-for-requests-request
    # https://majornetwork.net/2022/04/handling-retries-in-python-requests/
    # https://urllib3.readthedocs.io/en/latest/reference/urllib3.util.html#module-urllib3.util.retry
    # retry for all HTTP methods (even non-idempotent methods like POST)
    # retry for all connection failures
    # retry for transient HTTP error response codes:
    #   429 - Too Many Requests
    #   502 - Bad Gateway
    #   503 - Service Unavailable
    #   not including 500, 504, because retrying for all HTTP methods could be dangerous
    #   if some process has already happened
    # delays between retries follow exponential backoff pattern
    # A backoff factor to apply between attempts after the second try.
    # delay = {backoff factor} * (2 ** ({number of total retries} - 1))
    # backoff_factor=5, delays = [0, 10, 20, 40, 80, 120, 120, 120, 120]
    # max idle time is 10 min 30s
    return HTTPAdapter(max_retries=Retry(
        total=9,
        backoff_factor=5,
        allowed_methods=None,
        status_forcelist=[429, 502, 503]
    ))


# https://stackoverflow.com/a/51026159/2580077
class APIServerSession(requests.Session):
    def __init__(self):
        super().__init__()
        # Every step in the workflow calls this API at least twice
        # Failing a long run step because the API is momentarily down for maintenance is wasteful
        # Retry adapter will keep trying to re-connect on connection and other transient errors up to 10m30s
        adapter = make_retry_adapter()
        # noinspection HttpUrlsUsage
        self.mount("http://", adapter)
        self.mount("https://", adapter)
        self.base_url = config['api']['base_url']
        self.timeout = (config['api']['conn_timeout'], config['api']['read_timeout'])
        self.auth_token = config['api']['auth_token']

    def request(self, method, url, *args, **kwargs):
        joined_url = urljoin(self.base_url, url)
        if 'timeout' not in kwargs:
            kwargs['timeout'] = self.timeout

        # Add auth header
        headers = kwargs.pop('headers', {})
        headers['Authorization'] = f'Bearer {self.auth_token}'
        kwargs['headers'] = headers

        return super().request(method, joined_url, *args, **kwargs)


def str_to_int(d: dict, key: str):
    d['du_size'] = utils.parse_number(d.get(key, None))
    return d


def int_to_str(d: dict, key: str):
    if key in d and d[key] is not None:
        d[key] = str(d[key])
    return d


def dataset_getter(dataset: dict):
    DATE_FORMAT = '%Y-%m-%dT%H:%M:%S.%fZ'
    DATE_KEYS = ['created_at', 'updated_at']

    # convert du_size and size from string to int
    if dataset is None:
        return dataset

    for key in ['du_size', 'size']:
        str_to_int(dataset, key)
    dataset['files'] = [str_to_int(f, 'size') for f in dataset.get('files', [])]

    # convert date strings to date objects
    for date_key in DATE_KEYS:
        date_str = dataset.get(date_key, '')
        try:
            dataset[date_key] = datetime.strptime(date_str, DATE_FORMAT)
        except ValueError:
            dataset[date_key] = None
    return dataset


def dataset_setter(dataset: dict):
    # convert du_size and size from int to string
    if dataset is not None:
        for key in ['du_size', 'size']:
            int_to_str(dataset, key)
    return dataset


def get_all_datasets(dataset_type=None, name=None):
    with APIServerSession() as s:
        payload = {
            'type': dataset_type,
            'name': name,
        }
        r = s.get('datasets', params=payload)
        r.raise_for_status()
        datasets = r.json()
        return [dataset_getter(dataset) for dataset in datasets]


def get_dataset(dataset_id: str, files: bool = False):
    with APIServerSession() as s:
        payload = {
            'files': files
        }
        r = s.get(f'datasets/{dataset_id}', params=payload)
        r.raise_for_status()
        return dataset_getter(r.json())


def create_dataset(dataset):
    with APIServerSession() as s:
        r = s.post('datasets', json=dataset_setter(dataset))
        r.raise_for_status()
        return r.json()


def update_dataset(dataset_id, update_data):
    with APIServerSession() as s:
        r = s.patch(f'datasets/{dataset_id}', json=dataset_setter(update_data))
        r.raise_for_status()
        return r.json()


def add_files_to_dataset(dataset_id, files: list[dict]):
    with APIServerSession() as s:
        req_body = [int_to_str(f, 'size') for f in files]
        r = s.post(f'datasets/{dataset_id}/files', json=req_body)
        r.raise_for_status()


def upload_report(dataset_id, report_filename):
    filename = report_filename.name
    fileobj = open(report_filename, 'rb')
    with APIServerSession() as s:
        r = s.put(f'datasets/{dataset_id}/report', files={
            'report': (filename, fileobj)
        })
        r.raise_for_status()


def send_metrics(metrics):
    with APIServerSession() as s:
        r = s.post('metrics', json=metrics)
        r.raise_for_status()


def add_associations(associations):
    with APIServerSession() as s:
        r = s.post(f'datasets/associations', json=associations)
        r.raise_for_status()


def add_state_to_dataset(dataset_id, state, metadata=None):
    with APIServerSession() as s:
        r = s.post(f'datasets/{dataset_id}/states', json={
            'state': state,
            'metadata': metadata
        })
        r.raise_for_status()


if __name__ == '__main__':
    pass