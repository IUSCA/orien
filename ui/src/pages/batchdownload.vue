<script setup>

import batchDownloadService from '@/services/batchDownload';
import toast from "@/services/toast";
import workflowService from "@/services/workflow";

const batch_id = ref('')
const status_counts = ref({});
const disabled = ref(true);


const download = async () => {
  const results = await batchDownloadService.intiate_download(batch_id.value)

  if(results.status === 200) {
    toast.success('Download Initiated')
  } else {
    toast.error('Error Initiating Download')
  }
  batch_id.value = ''
  getCounts();
}


function getCounts() {

  
  return workflowService
    .getCountsByStatus()
    .then((res) => {
      status_counts.value = res.data;

      if ((status_counts.value['PENDING'] + status_counts.value['STARTED']) > 0) {
        disabled.value = true;
      } else {
        disabled.value = false;
      }
    })
    .catch((err) => {
      console.error(err);
    });
}

onMounted(() => {
  getCounts();
});




const { pause, resume, isActive } = useIntervalFn(
  () => {
    console.log("Refreshing Counts...");
    getCounts();
  },
  10000,
  {
    immediate: true,
  },
);


</script>

<template>

<!-- Input for path to script -->
<div class="flex flex-col justify-center items-center mt-2">
  <h1 class="text-2xl">Batch Download</h1>
  <div>
    <va-input label="Batch ID" v-model="batch_id" placeholder="Batch ID"  class="shadow my-2 mx-auto" />
  </div>
  <div>
    <va-button @click="download()" color="success" icon="download" :disabled="disabled"   preset="secondary" border-color="success" class="shadow my-2 mx-auto" > Initiate Batch Download</va-button>
  </div>
</div>
</template>

<route lang="yaml">
  meta:
    title: Batch Download
    nav: [{ label: "Batch Download" }]
  </route>