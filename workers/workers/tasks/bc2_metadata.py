import csv
import workers.api as api
from workers.config import config

def parse_csv(file_path, orien_avatar_key):
  data = []
  with open(file_path, mode='r') as file:
    csv_reader = csv.DictReader(file)
    for row in csv_reader:
      if row['bioloop_id'] == orien_avatar_key:
        data.append(row)
  return data

def get_metadata_from_csv(celery_task, dataset_id, **kwargs):

  dataset = api.get_dataset(dataset_id=dataset_id)

  file_path = config['csv_path']
  data = { "metadata": []}
  parsed_data = parse_csv(file_path, dataset['name'])


  keys = []

  # iterate through key value pairs in data - put in format api expects
  for key, value in parsed_data[0].items():
    keys.append(key)
    data['metadata'].append({
      "name": key,
      "data": value
    })
    

  # check if metadata fields already exist - create it if not
  api.update_metadata_fields(data=keys)  
    
  # create metadata for new dataset
  api.create_metadata(dataset_id=dataset_id, data=data)

  return dataset_id,
