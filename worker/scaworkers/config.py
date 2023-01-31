import datetime

# archiving directory name has year in its path to
# make it easier to purge data based on the year it was archived
YEAR = datetime.datetime.now().year
config = {
    'genome_file_types': ['.cbcl', '.bcl', '.bcl.gz', '.bgzf', '.fastq.gz', '.bam', '.bam.bai', '.vcf.gz',
                          '.vcf.gz.tbi', '.vcf'],
    'api': {
        'username': 'user',
        'password': 'pass',
        'base_url': 'http://localhost:3030'
    },
    'paths': {
        'scratch': '/N/scratch/dgluser/test',
        'archive': f'archive/{YEAR}',
        'stage': '/N/scratch/dgluser/test/stage',
    },
    'registration': {
        'source_dirs': ['/N/project/DG_Multiple_Myeloma/share'],
        'rejects': ['.snapshots'],
        'wait_between_scans': 5 * 60,
        'recency_threshold': 60 * 60
    }

}