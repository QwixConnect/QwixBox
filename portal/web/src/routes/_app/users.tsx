import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { authClient } from "../../lib/auth-client";
import { api, endpoints } from "../../lib/api";
import { notifyRemoved, notifySaved } from "../../lib/notify";
import { ROLE_NAMES, useRole, type RoleName } from "../../lib/use-role";
import { ErrorAlert, PageHeader, QueryState, RoleGate } from "../../components/Resource";

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  user?: { email?: string; name?: string };
};

function AddMemberModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    initialValues: { email: "", role: "member" as RoleName },
    validate: {
      email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Valid email required"),
    },
  });

  const mutation = useMutation({
    mutationFn: (values: { email: string; role: RoleName }) => endpoints.addMember(values),
    onSuccess: (res) => {
      notifySaved(`${res.email} — ${res.status}`);
      void qc.invalidateQueries({ queryKey: ["members"] });
      form.reset();
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Add member">
      <form
        onSubmit={form.onSubmit((values) => mutation.mutate(values))}
      >
        <Stack>
          <TextInput
            label="Email"
            description="Must already have a portal account. Contact the operator to create an account."
            required
            {...form.getInputProps("email")}
          />
          <Select
            label="Role"
            data={ROLE_NAMES.map((r) => ({ value: r, label: r }))}
            {...form.getInputProps("role")}
          />
          <ErrorAlert error={mutation.error} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Add
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function UsersPage() {
  const qc = useQueryClient();
  const { role: myRole } = useRole();
  const [adding, setAdding] = useState(false);
  const canManage = myRole === "owner" || myRole === "admin";

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const res = await authClient.organization.listMembers();
      if (res.error) throw new Error(res.error.message ?? "Could not list members");
      return (res.data?.members ?? []) as MemberRow[];
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      api.patch(`/tenant/members/${memberId}`, { role }),
    onSuccess: () => {
      notifySaved("Role updated");
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["active-member-role"] });
    },
  });

  const remove = useMutation({
    mutationFn: (memberIdOrEmail: string) =>
      api.delete(`/tenant/members/${memberIdOrEmail}`),
    onSuccess: () => {
      notifyRemoved("Member removed");
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const owners = (data ?? []).filter((m) => m.role === "owner");

  return (
    <>
      <PageHeader
        title="Users"
        description="People with portal access to this tenant. Accounts are created by an operator; this page only attaches them."
        action={
          canManage ? (
            <Button onClick={() => setAdding(true)}>Add member</Button>
          ) : undefined
        }
      />

      <ErrorAlert error={updateRole.error ?? remove.error} />

      <QueryState
        data={data}
        error={error}
        isPending={isPending}
        isSuccess={isSuccess}
        isPaused={isPaused}
        emptyMessage="No members yet."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Joined</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((m) => {
              const isLastOwner = m.role === "owner" && owners.length === 1;
              const joined =
                typeof m.createdAt === "string"
                  ? m.createdAt
                  : m.createdAt instanceof Date
                    ? m.createdAt.toISOString()
                    : "";
              return (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Text size="sm">{m.user?.email ?? m.userId}</Text>
                    {m.user?.name ? (
                      <Text size="xs" c="dimmed">
                        {m.user.name}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    {canManage ? (
                      <Select
                        size="xs"
                        w={140}
                        data={ROLE_NAMES.map((r) => ({ value: r, label: r }))}
                        value={m.role}
                        disabled={isLastOwner}
                        onChange={(value) => {
                          if (!value || value === m.role) return;
                          updateRole.mutate({ memberId: m.id, role: value });
                        }}
                      />
                    ) : (
                      <Badge variant="light">{m.role}</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {joined ? new Date(joined).toLocaleDateString() : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {canManage ? (
                      <RoleGate resource="tenant" action="update" mode="disable">
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          disabled={isLastOwner}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${m.user?.email ?? "this member"} from the tenant?`,
                              )
                            ) {
                              remove.mutate(m.id);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </RoleGate>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </QueryState>

      {adding && <AddMemberModal opened onClose={() => setAdding(false)} />}
    </>
  );
}

export const Route = createFileRoute("/_app/users")({ component: UsersPage });
