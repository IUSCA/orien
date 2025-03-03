<template>
  <va-modal v-model="visible" fixed-layout hide-default-actions size="auto" title="Dataset Search">
    <template #header>
      <div class="flex justify-between mb-2">
        <div class="flex items-center gap-3">
          <Icon icon="mdi:database-search" class="text-xl" />
          <h3 class="text-lg font-semibold">Dataset Search</h3>
        </div>
        <div class="flex justify-end">
          <va-button-toggle preset="secondary" border-color="primary" v-model="view"
            :options="[{ icon: 'info', value: 'info' }, { icon: 'sell', value: 'meta' }]" />
        </div>
      </div>
    </template>

    <div class="w-full">

      <div v-if="view === 'info'">
        <va-form class="flex flex-col gap-3 md:gap-5">
          <!-- name filter -->
          <va-input label="Name" v-model="form.name"
            placeholder="Enter a term that matches any part of the dataset name" />

          <!-- checkbox: deleted filter -->
          <va-checkbox v-model="form.deleted" label="Is Deleted" />

          <div class="flex gap-3">
            <!-- archived filter -->
            <va-select v-model="form.archived" :options="[
              { name: 'All', id: null },
              { name: 'True', id: true },
              { name: 'False', id: false },
            ]" text-by="name" value-by="id" label="Archived" placeholder="Choose a value">
              <template #prependInner>
                <Icon icon="mdi:archive-arrow-down" class="text-xl" />
              </template>
            </va-select>

            <!-- staged filter -->
            <va-select v-model="form.staged" :options="[
              { name: 'All', id: null },
              { name: 'True', id: true },
              { name: 'False', id: false },
            ]" text-by="name" value-by="id" label="Staged" placeholder="Choose a value">
              <template #prependInner>
                <Icon icon="mdi-cloud-sync" class="text-xl" />
              </template>
            </va-select>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 ">
            <!-- has_workflows filter -->
            <va-select v-model="form.has_workflows" :options="[
              { name: 'All', id: null },
              { name: 'With Workflows', id: true },
              { name: 'Without Workflows', id: false },
            ]" text-by="name" value-by="id" label="Workflows" placeholder="Choose a value">
              <template #prependInner>
                <Icon icon="mdi:map-marker-path" class="text-xl" />
              </template>
            </va-select>

            <!-- has_derived_data filter -->
            <va-select v-model="form.has_derived_data" :options="[
              { name: 'All', id: null },
              { name: 'With Derived Data', id: true },
              { name: 'Without Derived Data', id: false },
            ]" text-by="name" value-by="id" label="Derived Data" placeholder="Choose a value">
              <template #prependInner>
                <Icon icon="mdi:source-commit-end" class="text-xl" />
              </template>
            </va-select>

            <!-- has_source_data filter -->
            <va-select v-model="form.has_source_data" :options="[
              { name: 'All', id: null },
              { name: 'With Source Data', id: true },
              { name: 'Without Source Data', id: false },
            ]" text-by="name" value-by="id" label="Source Data" placeholder="Choose a value">
              <template #prependInner>
                <Icon icon="mdi:source-commit-start" class="text-xl" />
              </template>
            </va-select>
          </div>

          <!-- created_at date range filter -->
          <VaDateInput v-model="form.created_at" mode="range" placeholder="filter by created date range"
            label="Created At" />

          <!-- updated_at range filter -->
          <VaDateInput v-model="form.updated_at" mode="range" placeholder="filter by updated date range"
            label="Updated At" />
        </va-form>
      </div>
      <div v-if="view === 'meta'">
        <DatasetMetadataFilters @updateMetaData="updateMetaData" />
      </div>
    </div>

    <!-- footer -->
    <template #footer>
      <div class="flex w-full gap-5">
        <!-- cancel button -->
        <va-button preset="secondary" class="flex-none" @click="hide">
          Cancel
        </va-button>

        <!-- reset button -->
        <va-button preset="secondary" class="flex-none ml-auto" @click="handleReset">
          Reset
        </va-button>

        <!-- search button -->
        <va-button class="flex-none" @click="handleSearch"> Search </va-button>
      </div>
    </template>
  </va-modal>
</template>

<script setup>

import { useDatasetStore } from "@/stores/dataset";
import { storeToRefs } from "pinia";
import DatasetMetadataFilters from "./DatasetMetadataFilters.vue";
// const emit = defineEmits(["update"]);

// get type from route url
const type = useRoute().params.type;

// parent component can invoke these methods through the template ref
defineExpose({
  show,
  hide,
});

const emit = defineEmits(["search"]);

const store = useDatasetStore();
const { filters } = storeToRefs(store);

const visible = ref(false);
const form = ref({metaData: {}});
const view = ref("info");

function hide() {
  visible.value = false;
}

function show() {
  // update form with current filters
  form.value = { ...filters.value };
  visible.value = true;
}

function handleSearch() {
  // update store state
  filters.value = { ...form.value };
  hide();
  emit("search");
}

function handleReset() {
  form.value = store.defaultFilters();
}


const updateMetaData = (metaData) => {
  form.value['metaData'] = metaData;
};

</script>
