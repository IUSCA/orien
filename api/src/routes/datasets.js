const fsPromises = require('fs/promises');

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const createError = require('http-errors');
const {
  query, param, body, checkSchema,
} = require('express-validator');
const multer = require('multer');
const _ = require('lodash/fp');
const config = require('config');

// const logger = require('../services/logger');
const asyncHandler = require('../middleware/asyncHandler');
const { accessControl, getPermission } = require('../middleware/auth');
const { validate } = require('../middleware/validators');
const datasetService = require('../services/dataset');
const authService = require('../services/auth');

const isPermittedTo = accessControl('datasets');

const router = express.Router();
const prisma = new PrismaClient();

// stats - UI
router.get(
  '/stats',
  isPermittedTo('read'),
  validate([
    query('type').isIn(config.dataset_types).optional(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = 'Get summary statistics of datasets.'
    let result;
    let n_wf_result;
    if (req.query.type) {
      result = await prisma.$queryRaw`
        select count(*)     as "count",
        sum(du_size) as total_size,
        SUM(
                CASE
                    WHEN metadata -> 'num_genome_files' IS NOT NULL
                        THEN (metadata ->> 'num_genome_files')::int
                    ELSE 0
                    END
            )        AS total_num_genome_files
        from dataset
        where is_deleted = false and type = ${req.query.type};
      `;

      n_wf_result = await prisma.workflow.aggregate({
        where: {
          dataset: {
            type: req.query.type,
          },
        },
        _count: {
          id: true,
        },
      });
    } else {
      result = await prisma.$queryRaw`
        select 
          count(*) as "count", 
          sum(du_size) as total_size, 
          SUM(
                CASE
                    WHEN metadata -> 'num_genome_files' IS NOT NULL
                        THEN (metadata ->> 'num_genome_files')::int
                    ELSE 0
                    END
            )        AS total_num_genome_files
        from dataset 
        where is_deleted = false;
      `;

      n_wf_result = await prisma.workflow.aggregate({
        _count: {
          id: true,
        },
      });
    }
    const stats = result[0];
    res.json({
      ..._.mapValues(Number)(stats),
      workflows: n_wf_result?._count.id || 0,
    });
  }),
);

// add hierarchy association
const assoc_body_schema = {
  '0.source_id': {
    in: ['body'],
    isInt: {
      errorMessage: 'Source ID must be an integer',
    },
    toInt: true,
  },
  '0.derived_id': {
    in: ['body'],
    isInt: {
      errorMessage: 'Derived ID must be an integer',
    },
    toInt: true,
  },
};

const buildQueryObject = ({
  deleted, archived, staged, type, name, days_since_last_staged,
  has_workflows, has_derived_data, has_source_data,
  created_at_start, created_at_end, updated_at_start, updated_at_end,
}, metaData = {}) => {
  const query_obj = _.omitBy(_.isUndefined)({
    is_deleted: deleted,
    is_staged: staged,
    type,
    name: name ? {
      contains: name,
      mode: 'insensitive', // case-insensitive search
    } : undefined,
  });




  // has_workflows=true: datasets with one or more workflows associated
  // has_workflows=false: datasets with no workflows associated
  // has_workflows=undefined/null: no query based on workflow association
  if (!_.isNil(has_workflows)) {
    query_obj.workflows = { [has_workflows ? 'some' : 'none']: {} };
  }

  if (!_.isNil(has_derived_data)) {
    query_obj.derived_datasets = { [has_derived_data ? 'some' : 'none']: {} };
  }

  if (!_.isNil(has_source_data)) {
    query_obj.source_datasets = { [has_source_data ? 'some' : 'none']: {} };
  }

  if (!_.isNil(archived)) {
    query_obj.archive_path = archived ? { not: null } : null;
  }

  // staged datasets where there is no STAGED state in last x days
  if (_.isNumber(days_since_last_staged)) {
    const xDaysAgo = new Date();
    xDaysAgo.setDate(xDaysAgo.getDate() - days_since_last_staged);

    query_obj.is_staged = true;
    query_obj.NOT = {
      states: {
        some: {
          state: 'STAGED',
          timestamp: {
            gte: xDaysAgo,
          },
        },
      },
    };
  }

  // created_at filter
  if (created_at_start && created_at_end) {
    query_obj.created_at = {
      gte: new Date(created_at_start),
      lte: new Date(created_at_end),
    };
  }

  // updated_at filter
  if (updated_at_start && updated_at_end) {
    query_obj.updated_at = {
      gte: new Date(updated_at_start),
      lte: new Date(updated_at_end),
    };
  }

  return query_obj;
};


router.post(
  '/associations',
  isPermittedTo('update'),
  validate([
    checkSchema(assoc_body_schema),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Add new associations between datasets
    await prisma.dataset_hierarchy.createMany({
      data: req.body,
    });
    res.sendStatus(200);
  }),
);

router.post('/search',
  isPermittedTo('read'),
  // validate([
  //   body('deleted').toBoolean().default(false),
  //   body('has_workflows').toBoolean().optional(),
  //   body('has_derived_data').toBoolean().optional(),
  //   body('has_source_data').toBoolean().optional(),
  //   body('archived').toBoolean().optional(),
  //   body('staged').toBoolean().optional(),
  //   body('type').isIn(config.dataset_types).optional(),
  //   body('name').optional(),
  //   body('days_since_last_staged').isInt().toInt().optional(),
  //   body('bundle').optional().toBoolean(),
  //   body('created_at_start').isISO8601().optional(),
  //   body('created_at_end').isISO8601().optional(),
  //   body('updated_at_start').isISO8601().optional(),
  //   body('updated_at_end').isISO8601().optional(),
  //   body('limit').isInt({ min: 1 }).toInt().optional(), // optional because watch script needs all datasets at once
  //   body('offset').isInt({ min: 0 }).toInt().optional(),
  //   body('sort_by').default('updated_at'),
  //   body('sort_order').default('desc').isIn(['asc', 'desc']),
  // ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']

    const { metaData } = req.body
    delete req.body.metaData



    for (const [key, value] of Object.entries(req.body)) {
      if (value === null) {
        delete req.body[key]
      }
    }

    const query_obj = buildQueryObject(req.body, metaData);

    const filterQuery = { where: query_obj };

    const orderBy = {
      [req.body.sort_by]: req.body.sort_order,
    };
    const datasetRetrievalQuery = {
      skip: req.body.offset,
      take: req.body.limit,
      ...filterQuery,
      orderBy,
      include: {
        ...datasetService.INCLUDE_WORKFLOWS,
        source_datasets: true,
        derived_datasets: true,
        bundle: 'bundle' in req.body ? req.body.bundle : false
      },
    };

    if (Object.keys(metaData).length > 0) {

      let keywords = metaDataQuery(metaData)

      datasetRetrievalQuery.where = {
        ...datasetRetrievalQuery.where,
        keywords
      }


    }

    console.log('QUERY', JSON.stringify(datasetRetrievalQuery));
    console.log('FILTER', filterQuery);

    // console.log(JSON.stringify(filterQuery, null, 2));
    const [datasets, count] = await prisma.$transaction([
      prisma.dataset.findMany({ ...datasetRetrievalQuery }),
      prisma.dataset.count({ ...filterQuery }),
    ]);

    // console.log(datasets)

    res.json({
      metadata: { count },
      datasets,
    });
  }),
);

const metaDataQuery = (metaData) => {

  console.log('META DATA', metaData);

  let keywords = { some: {} }

  if (Object.keys(metaData).length === 1) {
    for (const key of Object.keys(metaData)) {
      const value = metaData[key]['data']['value']
      keywords['some'] = {
        value: {
          [metaData[key]['op'] === '' ? 'equals' : getOp(metaData[key]['op'])]: value
        }

      }
    }
  } else {

    for (const key of Object.keys(metaData)) {
      const value = metaData[key]['data']['value'];
      const condition = {
        value: {
          [metaData[key]['op'] === '' ? 'contains' : getOp(metaData[key]['op'])]: value
        }
      };
      if(! ('AND' in keywords.some)) 
        keywords.some = { AND: [] }

      keywords.some.AND.push(condition);
    }
  }


  console.log('KEYWORDS', keywords);

  return keywords;
}

const getOp = (op) => {
  switch (op) {
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '=':
      return 'equals';
  }
}


// Get all datasets, and the count of datasets. Results can optionally be filtered and sorted by
// the criteria specified.
// Used by workers + UI.
router.get(
  '/',
  isPermittedTo('read'),
  validate([
    query('deleted').toBoolean().default(false),
    query('has_workflows').toBoolean().optional(),
    query('has_derived_data').toBoolean().optional(),
    query('has_source_data').toBoolean().optional(),
    query('archived').toBoolean().optional(),
    query('staged').toBoolean().optional(),
    query('type').isIn(config.dataset_types).optional(),
    query('name').notEmpty().escape().optional(),
    query('days_since_last_staged').isInt().toInt().optional(),
    query('bundle').optional().toBoolean(),
    query('created_at_start').isISO8601().optional(),
    query('created_at_end').isISO8601().optional(),
    query('updated_at_start').isISO8601().optional(),
    query('updated_at_end').isISO8601().optional(),
    query('limit').isInt({ min: 1 }).toInt().optional(), // optional because watch script needs all datasets at once
    query('offset').isInt({ min: 0 }).toInt().optional(),
    query('sort_by').default('updated_at'),
    query('sort_order').default('desc').isIn(['asc', 'desc']),

  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    console.log('QUERY', req.query);
    const query_obj = buildQueryObject(req.query);

    const filterQuery = { where: query_obj };
    const orderBy = {
      [req.query.sort_by]: req.query.sort_order,
    };
    const datasetRetrievalQuery = {
      skip: req.query.offset,
      take: req.query.limit,
      ...filterQuery,
      orderBy,
      include: {
        ...datasetService.INCLUDE_WORKFLOWS,
        source_datasets: true,
        derived_datasets: true,
        bundle: req.query.bundle || false,
      },
    };

    // console.log(JSON.stringify(filterQuery, null, 2));
    const [datasets, count] = await prisma.$transaction([
      prisma.dataset.findMany({ ...datasetRetrievalQuery }),
      prisma.dataset.count({ ...filterQuery }),
    ]);

    res.json({
      metadata: { count },
      datasets,
    });
  }),
);

const dataset_access_check = asyncHandler(async (req, res, next) => {
  // assumes req.params.id is the dataset id user is requesting
  // access check
  const permission = getPermission({
    resource: 'datasets',
    action: 'read',
    requester_roles: req?.user?.roles,
  });
  if (!permission.granted) {
    const user_dataset_assoc = await datasetService.has_dataset_assoc({
      username: req.user.username,
      dataset_id: req.params.id,
    });
    if (!user_dataset_assoc) {
      return next(createError.Forbidden());
    }
  }
  next();
});

// get by id - worker + UI
router.get(
  '/:id',
  validate([
    param('id').isInt().toInt(),
    query('files').toBoolean().default(false),
    query('workflows').toBoolean().default(false),
    query('last_task_run').toBoolean().default(false),
    query('prev_task_runs').toBoolean().default(false),
    query('only_active').toBoolean().default(false),
    query('bundle').optional().toBoolean(),
    query('include_projects').optional().toBoolean(),
  ]),
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // only select path and md5 columns from the dataset_file table if files is true

    const dataset = await datasetService.get_dataset({
      id: req.params.id,
      files: req.query.files,
      workflows: req.query.workflows,
      last_task_run: req.query.last_task_run,
      prev_task_runs: req.query.prev_task_runs,
      only_active: req.query.only_active,
      bundle: req.query.bundle || false,
      includeProjects: req.query.include_projects || false,
    });
    res.json(dataset);
  }),
);

// create - worker
router.post(
  '/',
  isPermittedTo('create'),
  validate([
    body('du_size').optional().notEmpty().customSanitizer(BigInt), // convert to BigInt
    body('size').optional().notEmpty().customSanitizer(BigInt),
    body('bundle_size').optional().notEmpty().customSanitizer(BigInt),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = 'Create a new dataset.'
    /* #swagger.description = 'workflow_id is optional. If the request body has workflow_id,
        a new relation is created between dataset and given workflow_id'
    */
    const { workflow_id, state, ...data } = req.body;

    // create workflow association
    if (workflow_id) {
      data.workflows = {
        create: [
          {
            id: workflow_id,
          },
        ],
      };
    }

    // add a state
    data.states = {
      create: [
        {
          state: state || 'REGISTERED',
        },
      ],
    };

    // create dataset along with associations
    const dataset = await prisma.dataset.create({
      data,
      include: {
        ...datasetService.INCLUDE_WORKFLOWS,
      },
    });


    res.json(dataset);
  }),
);

// modify - worker
router.patch(
  '/:id',
  isPermittedTo('update'),
  validate([
    param('id').isInt().toInt(),
    body('du_size').optional().notEmpty().bail()
      .customSanitizer(BigInt), // convert to BigInt
    body('size').optional().notEmpty().bail()
      .customSanitizer(BigInt),
    body('bundle_size').optional().notEmpty().bail()
      .customSanitizer(BigInt),
    body('bundle').optional().isObject(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = 'Modify dataset.'
    /* #swagger.description =
        To add files use POST "/datasets/:id/files"
        To add workflow use POST "/datasets/:id/workflows"
        To add state use POST "/datasets/:id/state"
    */
    const datasetToUpdate = await prisma.dataset.findFirst({
      where: {
        id: req.params.id,
      },
    });
    if (!datasetToUpdate) { return next(createError(404)); }

    const { metadata, ...data } = req.body;
    data.metadata = _.merge(datasetToUpdate?.metadata)(metadata); // deep merge

    if (req.body.bundle) {
      data.bundle = {
        upsert: {
          create: req.body.bundle,
          update: req.body.bundle,
        },
      };
    }

    const dataset = await prisma.dataset.update({
      where: {
        id: req.params.id,
      },
      data,
      include: {
        ...datasetService.INCLUDE_WORKFLOWS,
        source_datasets: true,
        derived_datasets: true,
      },
    });
    res.json(dataset);
  }),
);

// add files to dataset - worker
router.post(
  '/:id/files',
  isPermittedTo('update'),
  validate([
    param('id').isInt().toInt(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Associate files to a dataset
    const data = req.body.map((f) => ({
      path: f.path,
      md5: f.md5,
      size: BigInt(f.size),
      filetype: f.type,
    }));
    datasetService.add_files({ dataset_id: req.params.id, data });

    res.sendStatus(200);
  }),
);

// add workflow ids to dataset
router.post(
  '/:id/workflows',
  isPermittedTo('update'),
  validate([
    param('id').isInt().toInt(),
    body('workflow_id').notEmpty(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Associate workflow_id to a dataset
    await prisma.workflow.create({
      data: {
        id: req.body.workflow_id,
        dataset_id: req.params.id,
      },
    });
    res.sendStatus(200);
  }),
);

// add state to dataset
router.post(
  '/:id/states',
  isPermittedTo('update'),
  validate([
    param('id').isInt().toInt(),
    body('state').notEmpty(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Add new state to a dataset
    await prisma.dataset_state.create({
      data: _.omitBy(_.isNil)({
        state: req.body.state,
        dataset_id: req.params.id,
        metadata: req.body.metadata,
      }),
    });
    res.sendStatus(200);
  }),
);

// delete - UI
router.delete(
  '/:id',
  isPermittedTo('delete'),
  validate([
    param('id').isInt().toInt(),
  ]),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = starts a delete archive workflow which will
    // mark the dataset as deleted on success.
    const _dataset = await datasetService.get_dataset({
      id: req.params.id,
      workflows: true,
    });

    if (_dataset) {
      await datasetService.soft_delete(_dataset, req.user?.id);
      res.send();
    } else {
      next(createError(404));
    }
  }),
);

// Launch a workflow on the dataset - UI
router.post(
  '/:id/workflow/:wf',
  accessControl('workflow')('create'),
  validate([
    param('id').isInt().toInt(),
    param('wf').isIn(['stage', 'integrated']),
  ]),
  (req, res, next) => {
    // admin and operator roles can run stage and integrated workflows
    // user role can only run stage workflows

    // allowed_wfs is an object with keys as workflow names and values as true
    // filter only works on objects not arrays, so we use an object with true value
    const allowed_wfs = req.permission.filter({ [req.params.wf]: true });
    if (allowed_wfs[req.params.wf]) {
      return next();
    }
    next(createError.Forbidden());
  },
  // user role can only run wf on the datasets they can access through project associations
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Create and start a workflow and associate it.
    // Allowed names are stage, integrated

    // Log the staging attempt first.
    if (req.params.wf === 'stage') {
      try {
        await prisma.stage_request_log.create({
          data: {
            dataset_id: req.params.id,
            user_id: req.user.id,
          },
        });
      } catch (e) {
        // console.log()
      }
    }

    const dataset = await datasetService.get_dataset({
      id: req.params.id,
      workflows: true,
    });

    const wf_name = req.params.wf;
    const wf = await datasetService.create_workflow(dataset, wf_name);
    return res.json(wf);
  }),
);

const report_storage = multer.diskStorage({
  async destination(req, file, cb) {
    try {
      const dataset = await prisma.dataset.findFirst({
        where: {
          id: req.params.id,
        },
      });

      if (dataset?.metadata?.report_id) {
        const parent_dir = `reports/${dataset?.metadata?.report_id}`;
        await fsPromises.mkdir(parent_dir, {
          recursive: true,
        });

        cb(null, parent_dir);
      } else {
        cb('report_id is not set');
      }
    } catch (e) {
      cb(e);
    }
  },

  filename(req, file, cb) {
    cb(null, 'multiqc_report.html');
  },
});

// upload a report - worker
router.put(
  '/:id/report',
  isPermittedTo('update'),
  validate([
    param('id').isInt().toInt(),
  ]),
  multer({ storage: report_storage }).single('report'),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Upload a QC report (html file) of this dataset
    res.json({
      path: req.file.path,
    });
  }),
);

router.get(
  '/:id/files',
  validate([
    param('id').isInt().toInt(),
    query('basepath').default(''),
  ]),
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Get a list of files and directories under basepath

    const files = await datasetService.files_ls({
      dataset_id: req.params.id,
      base: req.query.basepath,
    });
    // cache indefinitely - 1 year
    // use ui/src/config.js file_browser.cache_busting_id to invalidate cache if a need arises
    res.set('Cache-control', 'private, max-age=31536000');
    res.json(files);
  }),
);

router.get(
  '/:id/filetree',
  validate([
    param('id').isInt().toInt(),
  ]),
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Get the file tree

    const files = await prisma.dataset_file.findMany({
      where: {
        dataset_id: req.params.id,
      },
    });
    const root = datasetService.create_filetree(files);
    res.json(root);
  }),
);

router.get(
  '/download/:id',
  validate([
    param('id').isInt().toInt(),
    query('file_id').isInt().toInt().optional(),
  ]),
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Get file download URL and token

    const isFileDownload = !!req.query.file_id;

    // Log the data access attempt first.
    // Catch errors to ensure that logging does not get in the way of a token being returned.
    try {
      await prisma.data_access_log.create({
        data: {
          access_type: 'BROWSER',
          file_id: isFileDownload ? req.query.file_id : undefined,
          dataset_id: !isFileDownload ? req.params.id : undefined,
          user_id: req.user.id,
        },
      });
    } catch (e) {
      // console.log();
    }

    let file;
    if (isFileDownload) {
      file = await prisma.dataset_file.findFirstOrThrow({
        where: {
          id: req.query.file_id,
          dataset_id: req.params.id,
        },
      });
    }

    const dataset = await prisma.dataset.findFirstOrThrow({
      where: {
        id: req.params.id,
      },
      include: {
        bundle: true,
      },
    });

    if (dataset.metadata.stage_alias) {
      const download_file_path = isFileDownload
        ? `${dataset.metadata.stage_alias}/${file.path}`
        : `${dataset.metadata.bundle_alias}`;

      const url = new URL(download_file_path, config.get('download_server.base_url'));

      // use url.pathname instead of download_file_path to deal with spaces in the file path
      // oauth scope cannot contain spaces
      const download_token = await authService.get_download_token(url.pathname);
      res.json({
        url: url.href,
        bearer_token: download_token.accessToken,
      });
    } else {
      next(createError.NotFound('Dataset is not prepared for download'));
    }
  }),
);

router.get(
  '/:id/files/search',
  validate([
    param('id').isInt().toInt(),
    query('name').default(''),
    query('basepath').optional().default(''),
    query('filetype').isIn(['file', 'directory', 'symbolic link']).optional(),
    query('extension').optional(),
    query('min_file_size').isInt().toInt().optional(),
    query('max_file_size').isInt().toInt().optional(),
    query('skip').isInt().toInt().optional()
      .default(0),
    query('take').isInt().toInt().optional()
      .default(1000),
  ]),
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Get a list of files and directories under basepath
    const files = await datasetService.search_files({
      dataset_id: req.params.id,
      base: req.query.basepath,
      ...req.query,
    });
    res.json(files);
  }),
);




router.get('/:id/metadata',
  dataset_access_check,
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Update dataset metadata
    const { id } = req.params;

    // console.log('ID', id);
    const results = await prisma.keyword_value.findMany({
      where: {

        dataset_id: parseInt(id),
        keyword: {
          visible: true,
        },

      },
      include: {
        keyword: true,
      },
    });

    // console.log('KEYWORD VALUE', results);

    res.json(results);

  })
);

router.get('/metadata/all/:type',
  isPermittedTo('read'),
  asyncHandler(async (req, res, next) => {
    // #swagger.tags = ['datasets']
    // #swagger.summary = Get unique metadata possibilities
    const { type } = req.params;

    // Get the dataset IDs for the given type
    const dataset_ids = await prisma.dataset.findMany({
      where: {
        type,
      },
      select: {
        id: true,
      },
    });


    // Filter by the dataset IDs, getting unique values for the given type
    const keyword_value = await prisma.keyword_value.findMany({
      where: {
        dataset_id: {
          in: dataset_ids.map((d) => d.id),
        },
        keyword: {
          visible: true,
        },
      },
      distinct: ['value'],
      include: {
        keyword: true,
      },
    });

    let results = {}

    for (const kv of keyword_value) {
      const name = kv.keyword.name;

      // console.log('KV', kv);
      if (!results[name]) {
        results[name] = [];
      }
      if (!results[name].includes(kv.value)) {
        results[name].push(kv);
      }
    }

    // Convert the Set to an array and return it
    res.json(results)
  })
);

router.patch('/:id/metadata', asyncHandler(async (req, res, next) => {
  // #swagger.tags = ['datasets']
  // #swagger.summary = Update dataset metadata
  const { id } = req.params;
  const { metadata } = req.body;


  const dataset = await prisma.dataset.findFirst({where: {id: parseInt(id)}});

  dataset.workflows = []

  console.log('DATASET', dataset);

  await datasetService.create_workflow(dataset, 'metadata');

  let updateMetadata = []

  // delete all metadata for the dataset
  updateMetadata.push(await prisma.keyword_value.deleteMany({
    where: {
      dataset_id: parseInt(id),
    }
  }));

  // create new metadata
  const createMetadataPromises = metadata.map(mdata => {
    const keyword_id = parseInt(mdata.keyword_id);
    const value = mdata.data;

    return prisma.keyword_value.create({
      data: {
        dataset_id: parseInt(id),
        keyword_id: keyword_id,
        value: value,
      }
    });
  })

  updateMetadata = updateMetadata.concat(createMetadataPromises);

  try {
    const results = await Promise.all(updateMetadata);
    console.log('Upsert results:', results);
    res.json(results);
  } catch (error) {
    console.error('Error during upsert:', error);
    res.status(500).json({ error: 'Error during update/create' });
  }
}));

router.post('/metadata/keyword', asyncHandler(async (req, res, next) => {
  // #swagger.tags = ['datasets']
  // #swagger.summary = Update dataset metadata
  const { keyword, description } = req.body;


  
  const results = await prisma.keyword.create({
    data: {
      keyword,
      description,
      datatype: 'STRING',
    },
  });
  res.json(results);
}));

router.get('/metadata/fields', asyncHandler(async (req, res, next) => {

  const results = await prisma.keyword.findMany({
    where: {
      visible: true,
    },
  });

  console.log("RESULTS", results)

  res.json(results);

}));

router.post('/metadata/fields', asyncHandler(async (req, res, next) => {
  // #swagger.tags = ['datasets']
  // #swagger.summary = Update dataset metadata
  const { name, description } = req.body;

  console.log('BODY', req.body);



  
  const results = await prisma.keyword.create({
    data: {
      name,
      description,
      datatype: 'STRING',
    },
  });
  res.json(results);


}));




router.patch('/metadata/fields/:id', asyncHandler(async (req, res, next) => {

  const { id } = req.params;
  const { name, description, datatype, visible, locked } = req.body;

  const results = await prisma.keyword.update({
    where: {
      id: parseInt(id),
    },
    data: {
      name,
      description,
      visible,
      locked,
      datatype
    },
  });

  res.json(results);

}));

module.exports = router;
